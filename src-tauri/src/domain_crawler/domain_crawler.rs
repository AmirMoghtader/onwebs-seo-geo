//! Main domain crawler orchestration
//! On expansion keep adding separate modules to slim down the codebase and improve maintainability.
//! This module contains the main `crawl_domain` function that coordinates
//! the entire crawling process. The actual URL processing is delegated to
//! the `url_processor` module.

use reqwest::Client;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;
use tokio::sync::{Mutex, Semaphore};
use tokio::time::{sleep, Duration};
use url::Url;
use dashmap::DashMap;

use crate::domain_crawler::helpers::content_encoding;
use crate::domain_crawler::helpers::domain_checker::url_check;
use crate::domain_crawler::helpers::favicon;
use crate::domain_crawler::helpers::images_selector::{
    ImageMetadataChecker, DEFAULT_IMAGE_METADATA_CACHE_CAPACITY,
};
use crate::domain_crawler::helpers::robots::{self};
use crate::domain_crawler::helpers::sitemap;
use crate::domain_crawler::helpers::url_filters::UrlFilters;
use crate::domain_crawler::helpers::normalize_url::normalize_url;
use crate::domain_crawler::helpers::request_throttle::CrawlThrottle;
use crate::AppState;

use super::database::{self, Database, DatabaseError};
use super::helpers::links_status_code_checker::SharedLinkChecker;
use super::models::{DomainCrawlResults, LightCrawlResult};
use super::state::{to_database_results, CrawlerState, FailedUrl, ProgressData};
use super::url_processor::{process_url, update_state_and_emit_progress};

/// What the crawler is doing right now, emitted so the UI can show progress
/// even when the count is not moving. A crawl sitting at 0% because a host is
/// timing out looks identical to a crawl that is broken; this is the
/// difference.
#[derive(Clone, serde::Serialize)]
struct CrawlActivity {
    /// "fetching" | "error" | "queued" | "done"
    kind: String,
    url: String,
    /// human-readable detail: an HTTP status, or why the fetch failed
    detail: String,
    queued: usize,
    active: usize,
    crawled: usize,
}

/// Payload for the `crawl_rate_limited` event so the frontend can surface
/// server-driven backoff instead of the crawl silently appearing slow.
#[derive(Clone, serde::Serialize)]
struct RateLimitedData {
    /// Adaptive delay now applied between requests, in milliseconds
    delay_ms: u64,
    /// How long new task spawning is paused, in milliseconds
    cooldown_ms: u64,
    /// HTTP status that triggered the backoff (0 when detected from body content)
    status: u16,
}

type PersistenceErrorSlot = Arc<std::sync::Mutex<Option<String>>>;

fn record_persistence_error(slot: &PersistenceErrorSlot, message: String) {
    match slot.lock() {
        Ok(mut current) if current.is_none() => *current = Some(message),
        Ok(_) => {}
        Err(poisoned) => {
            let mut current = poisoned.into_inner();
            if current.is_none() {
                *current = Some(message);
            }
        }
    }
}

fn persistence_error(slot: &PersistenceErrorSlot) -> Option<String> {
    match slot.lock() {
        Ok(current) => current.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

/// Preserve transport/parser failures as first-class crawl rows.  A status-0
/// row keeps exports, history and the UI consistent with the failure counter
/// instead of silently dropping URLs that never produced an HTTP response.
fn failed_crawl_result(
    url: &Url,
    base_url: &Url,
    depth: usize,
    error: String,
) -> DomainCrawlResults {
    let mut result = DomainCrawlResults::default();
    result.url = url.to_string();
    result.original_url = result.url.clone();
    result.status_code = 0;
    result.status = Some(0);
    result.content_type = "Unknown".to_string();
    result.url_depth = Some(depth);
    result.https = url.scheme() == "https";
    result.crawl_error = Some(error.clone());
    result.indexability.indexability = 0.0;
    result.indexability.indexability_reason =
        format!("Not indexable: crawl error: {}", error);
    result.inoutlinks_status_codes.page = result.url.clone();
    result.inoutlinks_status_codes.base_url = base_url.clone();
    result
}

/// Records a worker that died from a panic rather than a cancellation.
///
/// A panicked worker leaves its URL with no row in the database while the
/// active-task guard still decrements, so the crawl would otherwise reach its
/// end condition and report success for a URL it never wrote. The first panic
/// wins; later ones are already covered by the same terminal outcome.
fn record_worker_panic(error: &tokio::task::JoinError, slot: &mut Option<String>) {
    if error.is_cancelled() {
        return;
    }
    tracing::error!("Crawl worker panicked: {}", error);
    if slot.is_none() {
        *slot = Some(format!("یکی از worker‌های کراول panic کرد: {}", error));
    }
}

/// Main entry point for domain crawling
pub async fn crawl_domain(
    domain: &str,
    app_handle: tauri::AppHandle,
    db: Result<Database, DatabaseError>,
    settings_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let settings = settings_state.settings.read().await.clone();
    // NOTE: the control flag is reset by the caller (`domain_crawl_command`)
    // before the crawl is exposed as active. Resetting it here would swallow a
    // Stop pressed while the database was still being initialised.
    let crawl_control = settings_state.crawl_control.clone();

    // The overall deadline starts here, not after metadata setup. Robots and
    // sitemap traversal run before the scheduler loop and used to be outside
    // the timeout entirely, so a slow sitemap could burn unbounded time before
    // the clock even started.
    let crawl_start_time = Instant::now();

    // Why the crawl ended, reported to the UI. A crawl that stops on a stall
    // or a timeout used to look identical to one that finished normally —
    // the progress bar simply froze and nothing explained it.
    let mut end_reason = "finished".to_string();
    let mut end_detail = String::new();

    // Extract all settings values we need to avoid borrowing issues
    let client_timeout = settings.client_timeout;
    let client_connect_timeout = settings.client_connect_timeout;
    let concurrent_requests = settings.concurrent_requests;
    let js_concurrency = settings.javascript_concurrency;
    let stall_check_interval = settings.stall_check_interval;
    let max_pending_time = settings.max_pending_time;
    let batch_size = settings.batch_size;
    let crawl_timeout = settings.crawl_timeout;
    let db_batch_size = settings.db_batch_size;
    let base_delay = settings.base_delay;
    let max_delay = settings.max_delay;
    let adaptive_crawling = settings.adaptive_crawling;
    let min_crawl_delay = settings.min_crawl_delay;

    let selected_user_agent = if settings.http_user_agent.trim().is_empty() {
        crate::settings::settings::default_http_user_agent()
    } else {
        settings.http_user_agent.trim().to_string()
    };

    let mut default_headers = reqwest::header::HeaderMap::new();
    default_headers.insert(reqwest::header::ACCEPT, "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7".parse().unwrap());
    default_headers.insert(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9".parse().unwrap());
    default_headers.insert(reqwest::header::UPGRADE_INSECURE_REQUESTS, "1".parse().unwrap());
    default_headers.insert(reqwest::header::CACHE_CONTROL, "max-age=0".parse().unwrap());

    // Compressed bodies are decoded by hand rather than by reqwest, because
    // reqwest's transparent decompression also removes Content-Length and
    // leaves no way to know how many bytes actually crossed the network — the
    // number Screaming Frog reports as "Transferred". We still ask for
    // compression; we just count the bytes before expanding them.
    default_headers.insert(
        reqwest::header::ACCEPT_ENCODING,
        content_encoding::ACCEPT_ENCODING.parse().unwrap(),
    );

    let client = Client::builder()
        .cookie_store(true)
        .user_agent(&selected_user_agent)
        .default_headers(default_headers)
        .timeout(Duration::from_secs(client_timeout))
        .connect_timeout(Duration::from_secs(client_connect_timeout))
        .redirect(reqwest::redirect::Policy::none())
        .no_gzip()
        .no_deflate()
        .no_brotli()
        .build()
        .map_err(|e| e.to_string())?;



    let url_checked = url_check(domain);
    let base_url = Url::parse(&url_checked).map_err(|_| "Invalid URL")?;
    let domain = base_url.clone();

    // Robots policies are keyed by exact origin and single-flighted. The
    // metadata client follows bounded robots redirects and uses the configured
    // robots UA independently from the page-fetch UA.
    let robots_cache = Arc::new(
        robots::RobotsPolicyCache::new(
            settings.robots_user_agent.clone(),
            Duration::from_secs(client_timeout),
            Duration::from_secs(client_connect_timeout),
            robots::DEFAULT_ROBOTS_CACHE_CAPACITY,
        )
        .map_err(|error| format!("Failed to initialize robots client: {}", error))?,
    );
    // List mode is an explicit set of URLs and deliberately ignores robots.
    // Avoid even the metadata request in that mode so the supplied list is the
    // exact request set and benchmarks do not gain a hidden robots fetch.
    let robots_data = if settings.list_mode {
        None
    } else {
        robots_cache.robots_data_for(&domain).await
    };
    let robots_blocked = robots_data
        .as_ref()
        .map(|d| d.blocked_urls.clone())
        .unwrap_or_default();
    let declared_sitemaps = robots_data
        .as_ref()
        .map(|data| data.sitemap_urls.clone())
        .unwrap_or_default();
    let robots_raw_text = robots_data.as_ref().map(|data| data.raw_text.clone());

    // Emit initial blocked info
    let _ = app_handle.emit("robots_blocked", &robots_blocked);

    // BACKGROUND TASKS (UI Updates & Favicon)
    let app_handle_for_spawn = app_handle.clone();
    let domain_clone = domain.clone();

    tokio::spawn(async move {
        // Run favicon check in parallel with UI updates
        let favicon_task = favicon::get_favicon(&domain_clone);

        // Emit robots raw text immediately if we already have it
        if let Some(raw_text) = robots_raw_text {
            if let Err(err) = app_handle_for_spawn.emit("robots", (&domain_clone, raw_text)) {
                eprintln!("Failed to emit robots data: {}", err);
            }
        } else {
            let _ = app_handle_for_spawn.emit(
                "robots",
                (&domain_clone, vec!["No robots.txt found".to_string()]),
            );
        }

        // Wait for favicon
        let favicon_result = favicon_task.await;

        match favicon_result {
            Ok(favicon_url) => {
                let _ = app_handle_for_spawn.emit("favicon", (&domain_clone, favicon_url));
            }
            Err(_) => {
                let _ = app_handle_for_spawn.emit("favicon", (&domain_clone, ""));
            }
        }
    });

    // Create the global URL status registry — shared between the crawler and the link checker
    // so that URLs already crawled are never re-requested during link checking.
    // DashMap is used here instead of RwLock<HashMap> to avoid blocking async executor threads.
    let url_status_registry: Arc<DashMap<String, u16>> = Arc::new(DashMap::with_capacity(4096));

    let link_checker = Arc::new(SharedLinkChecker::new(
        &settings,
        Some(selected_user_agent.clone()),
        url_status_registry.clone(),
    ));
    let state = Arc::new(Mutex::new(
        CrawlerState::new(None)
            .with_link_checker(link_checker.clone())
            .with_url_status_registry(url_status_registry)
            .with_robots_cache(robots_cache, !settings.list_mode),
    )); // DB is handled separately
    {
        let normalized_base = normalize_url(base_url.as_str());
        let normalized_url_obj = Url::parse(&normalized_base).unwrap_or_else(|_| base_url.clone());
        
        let mut state_guard = state.lock().await;

        // List mode seeds every supplied URL at depth 0 and relies on the
        // discovery gate in url_processor to stop there. Spider mode seeds only
        // the start URL and discovers the rest.
        if settings.list_mode && !settings.list_urls.is_empty() {
            let mut seeded = 0usize;
            for raw in &settings.list_urls {
                let normalized = normalize_url(raw);
                if let Ok(parsed) = Url::parse(&normalized) {
                    if state_guard.queued_url_set.insert(normalized.clone()) {
                        state_guard.queue.push_back((parsed, 0));
                        seeded += 1;
                    }
                }
            }
            // Without this guard an all-invalid list produces an empty queue, and
            // the crawl reports 100% progress and "success" with zero rows.
            if seeded == 0 {
                return Err(format!(
                    "List mode: none of the {} supplied URLs is a valid absolute URL. \
                     Use full addresses such as https://example.com/page.",
                    settings.list_urls.len()
                ));
            }

            state_guard.total_urls = seeded;
            tracing::info!("List mode: seeded {} URLs, discovery disabled", seeded);
        } else {
            state_guard.queue.push_back((normalized_url_obj, 0)); // Start at depth 0
            state_guard.queued_url_set.insert(normalized_base.clone());
            state_guard.total_urls = 1;
        }
        // pending_urls is populated at dequeue time (in the main loop batch drain), not here.
    }

    // Stop and the deadline have to be reachable here too. Both robots and
    // sitemap work happen before the scheduler loop, and a Stop pressed during
    // them used to be ignored until the first URL had been fetched. Setting
    // end_reason (rather than returning) keeps the normal completion path, so
    // the UI still receives its final progress and completion events.
    if end_reason == "finished" {
        if crawl_control.load(Ordering::Relaxed) == 2 {
            end_reason = "stopped".to_string();
            end_detail = "کراول توسط کاربر متوقف شد".to_string();
            tracing::info!("Crawl stopped by user during metadata setup.");
        } else if crawl_start_time.elapsed() > Duration::from_secs(crawl_timeout) {
            end_reason = "timeout".to_string();
            end_detail = format!("مهلت کلی کراول پس از {} ثانیه تمام شد", crawl_timeout);
            tracing::warn!("Crawl timed out during metadata setup.");
        }
    }

    // DISCOVER URLS FROM SITEMAPS
    // Include / Exclude from Configuration, compiled once for the whole crawl.
    let url_filters = UrlFilters::new(&settings.include_patterns, &settings.exclude_patterns);
    if !url_filters.is_empty() {
        tracing::info!(
            "URL filters active — {} include, {} exclude",
            settings.include_patterns.len(),
            settings.exclude_patterns.len()
        );
    }

    let sitemap_urls = if settings.list_mode {
        // Pulling in the sitemap would defeat the point of an explicit list.
        Default::default()
    } else {
        sitemap::extract_urls_from_sitemaps(&domain, &client, &declared_sitemaps).await
    };
    if !sitemap_urls.is_empty() {
        tracing::info!("Found {} URLs in sitemaps", sitemap_urls.len());

        // The frontend needs the declared list, not just the seeded crawl, so
        // the Sitemaps view can diff "declared in sitemap" against "actually
        // reached by the crawl" — that difference is what surfaces orphan URLs
        // and pages missing from the sitemap.
        let declared: Vec<String> = sitemap_urls.iter().cloned().collect();
        if let Err(err) = app_handle.emit("sitemap_urls", &declared) {
            eprintln!("Failed to emit sitemap urls: {}", err);
        }

        let mut state_guard = state.lock().await;
        state_guard.add_discovered_urls(
            sitemap_urls,
            &domain,
            settings.max_depth,
            settings.max_urls_per_domain,
            &url_filters,
        );
    } else {
        let empty: Vec<String> = Vec::new();
        let _ = app_handle.emit("sitemap_urls", &empty);
    }

    let (db_tx, mut db_rx) = tokio::sync::mpsc::channel(db_batch_size);
    let persistence_error_slot: PersistenceErrorSlot =
        Arc::new(std::sync::Mutex::new(None));

    let db_handle = match db.as_ref() {
        Ok(database) => {
            let db_pool = database.get_pool();
            let db_batch_size_clone = db_batch_size;
            let writer_error_slot = persistence_error_slot.clone();
            let handle = tokio::spawn(async move {
                let mut batch_results = Vec::with_capacity(db_batch_size_clone);
                let mut persisted_rows = 0usize;
                // Use an interval to ensure periodic flushing regardless of channel activity
                let mut interval = tokio::time::interval(Duration::from_secs(2));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

                loop {
                    tokio::select! {
                        recv_result = db_rx.recv() => {
                            match recv_result {
                                Some(result) => {
                                    batch_results.push(result);
                                    if batch_results.len() >= db_batch_size_clone {
                                        let batch = std::mem::take(&mut batch_results);
                                        let batch_len = batch.len();
                                        if let Err(error) = database::insert_bulk_crawl_data(
                                            db_pool.clone(),
                                            batch,
                                        )
                                        .await
                                        {
                                            let message = format!("Failed to persist crawl batch: {}", error);
                                            tracing::error!("{}", message);
                                            record_persistence_error(&writer_error_slot, message.clone());
                                            return Err(message);
                                        }
                                        persisted_rows += batch_len;
                                    }
                                }
                                None => break,
                            }
                        }
                        _ = interval.tick() => {
                            if !batch_results.is_empty() {
                                let batch = std::mem::take(&mut batch_results);
                                let batch_len = batch.len();
                                if let Err(error) = database::insert_bulk_crawl_data(
                                    db_pool.clone(),
                                    batch,
                                )
                                .await
                                {
                                    let message = format!("Failed to flush crawl batch: {}", error);
                                    tracing::error!("{}", message);
                                    record_persistence_error(&writer_error_slot, message.clone());
                                    return Err(message);
                                }
                                persisted_rows += batch_len;
                            }
                        }
                    }
                }
                if !batch_results.is_empty() {
                    let batch_len = batch_results.len();
                    if let Err(error) =
                        database::insert_bulk_crawl_data(db_pool, batch_results).await
                    {
                        let message = format!("Failed to persist final crawl batch: {}", error);
                        tracing::error!("{}", message);
                        record_persistence_error(&writer_error_slot, message.clone());
                        return Err(message);
                    }
                    persisted_rows += batch_len;
                }
                Ok::<usize, String>(persisted_rows)
            });
            Some(handle)
        }
        Err(error) => {
            return Err(format!("Database connection failed before crawl: {}", error));
        }
    };


    // Network permits cover only request + body transfer. Parsing, link/image
    // analysis and DB backpressure run in a bounded worker pipeline without
    // occupying a primary HTTP connection slot.
    let request_semaphore = Arc::new(Semaphore::new(concurrent_requests));
    let js_semaphore = Arc::new(Semaphore::new(js_concurrency));
    let image_semaphore = Arc::new(Semaphore::new(std::cmp::min(concurrent_requests, 50)));
    let image_metadata_checker = Arc::new(ImageMetadataChecker::new(
        client.clone(),
        image_semaphore,
        DEFAULT_IMAGE_METADATA_CACHE_CAPACITY,
    ));
    let request_throttle = Arc::new(CrawlThrottle::new(
        adaptive_crawling,
        base_delay,
        min_crawl_delay,
        max_delay,
    ));
    let worker_capacity = concurrent_requests.saturating_mul(4).clamp(1, 512);

    // Stop and the deadline have to be reachable here too. Both robots and
    // sitemap work happen before the scheduler loop, and a Stop pressed during
    // them used to be ignored until the first URL had been fetched. Setting
    // end_reason (rather than returning) keeps the normal completion path, so
    // the UI still receives its final progress and completion events.
    if end_reason == "finished" {
        if crawl_control.load(Ordering::Relaxed) == 2 {
            end_reason = "stopped".to_string();
            end_detail = "کراول توسط کاربر متوقف شد".to_string();
            tracing::info!("Crawl stopped by user during metadata setup.");
        } else if crawl_start_time.elapsed() > Duration::from_secs(crawl_timeout) {
            end_reason = "timeout".to_string();
            end_detail = format!("مهلت کلی کراول پس از {} ثانیه تمام شد", crawl_timeout);
            tracing::warn!("Crawl timed out during metadata setup.");
        }
    }

    let mut last_stall_check = Instant::now();
    let mut last_crawled_count = 0;

    let mut last_log_time = Instant::now();
    // Keep ownership of every crawl task. Detached tasks previously survived a
    // Stop/timeout and could continue fetching or writing after completion.
    let mut crawl_tasks = tokio::task::JoinSet::new();

    let mut worker_panic: Option<String> = None;

    while end_reason == "finished" && state.lock().await.should_continue() {
        while let Some(join_result) = crawl_tasks.try_join_next() {
            if let Err(error) = join_result {
                record_worker_panic(&error, &mut worker_panic);
            }
        }
        if let Some(panic_detail) = worker_panic.clone() {
            end_reason = "worker_error".to_string();
            end_detail = panic_detail;
            tracing::error!("Stopping crawl because a worker panicked: {}", end_detail);
            let _ = app_handle.emit("crawl_interrupted", ());
            break;
        }
        let control_status = crawl_control.load(Ordering::Relaxed);
        if let Some(error) = persistence_error(&persistence_error_slot) {
            end_reason = "persistence_error".to_string();
            end_detail = error;
            tracing::error!("Stopping crawl because persistence failed: {}", end_detail);
            let _ = app_handle.emit("crawl_interrupted", ());
            break;
        }
        if control_status == 2 {
            end_reason = "stopped".to_string();
            end_detail = "کراول توسط کاربر متوقف شد".to_string();
            tracing::info!("Crawl stopped by user.");
            // Empty the queue as well as leaving the loop. Without this, any
            // in-flight task that finishes after the break would still find
            // work waiting and the crawl would appear to carry on.
            let mut guard = state.lock().await;
            guard.queue.clear();
            guard.queued_url_set.clear();
            drop(guard);
            break;
        }
        if control_status == 1 {
            sleep(Duration::from_millis(200)).await;
            continue;
        }

        let to_spawn = {
            let mut state_guard = state.lock().await;
            state_guard.cleanup_stale_pending();

            // Check for stalling
            if last_stall_check.elapsed() > Duration::from_secs(stall_check_interval) {
                let stalled = state_guard.crawled_urls == last_crawled_count
                    && state_guard.last_activity.elapsed() > Duration::from_secs(max_pending_time)
                    && state_guard.queue.is_empty();

                if stalled {
                    end_reason = "stalled".to_string();
                    end_detail = format!(
                        "هیچ پاسخی از سرور نیامد؛ {} درخواست بیش از {} ثانیه بی‌جواب ماند",
                        state_guard.active_tasks, max_pending_time
                    );
                    tracing::info!(
                        "Crawler stall detected ({} active tasks hung for >{}s). Terminating crawl...",
                        state_guard.active_tasks,
                        max_pending_time
                    );
                    break;
                }
                last_crawled_count = state_guard.crawled_urls;
                last_stall_check = Instant::now();
            }

            // Periodic status log
            if last_log_time.elapsed() > Duration::from_secs(10) {
                tracing::info!(
                    "Status - Crawled: {}, Queue: {}, Pending: {}, Active: {}, Failed: {}",
                    state_guard.crawled_urls,
                    state_guard.queue.len(),
                    state_guard.pending_urls.len(),
                    state_guard.active_tasks,
                    state_guard.total_failed_count
                );
                last_log_time = Instant::now();
            }

            if state_guard.active_tasks >= worker_capacity {
                drop(state_guard);
                sleep(Duration::from_millis(10)).await;
                continue;
            }

            if state_guard.queue.is_empty() {
                if state_guard.is_truly_complete() {
                    break;
                }
                drop(state_guard);
                // In-flight workers commonly discover the next frontier while
                // parsing their response. A fixed 500ms poll here serialized
                // shallow/tree-shaped sites even when network concurrency was
                // available. Wake on completion, retaining a short control/
                // persistence heartbeat for long-running workers.
                if !crawl_tasks.is_empty() {
                    tokio::select! {
                        join_result = crawl_tasks.join_next() => {
                            if let Some(Err(error)) = join_result {
                                record_worker_panic(&error, &mut worker_panic);
                            }
                        }
                        _ = sleep(Duration::from_millis(50)) => {}
                    }
                } else {
                    tokio::task::yield_now().await;
                }
                continue;
            }

            let available_slots = worker_capacity.saturating_sub(state_guard.active_tasks);
            let available_batch = batch_size
                .min(state_guard.queue.len())
                .min(available_slots);
            let candidates: Vec<(url::Url, usize)> =
                state_guard.queue.drain(..available_batch).collect();
            let mut batch = Vec::with_capacity(candidates.len());
            for (url, depth) in candidates {
                let url_str = normalize_url(url.as_str());
                state_guard.queued_url_set.remove(&url_str);
                // A redirect may already have fetched a target that was still
                // queued. Do not issue a duplicate primary GET.
                if state_guard.visited.contains(&url_str) {
                    continue;
                }
                // Move from "queued" to "pending" (actively being fetched).
                // pending_urls is only populated here so it stays bounded by
                // the worker pipeline rather than the entire frontier.
                // making all pending_urls lookups cheap regardless of total queue depth.
                state_guard.pending_urls.insert(url_str.clone(), Instant::now());
                state_guard.active_tasks += 1;
                state_guard.active_urls.insert(url_str);
                batch.push((url, depth));
            }
            batch
        };

        if to_spawn.is_empty() {
            continue;
        }

        for (url, depth) in to_spawn {
            let client_clone = client.clone();
            let base_url_clone = base_url.clone();
            let state_clone = state.clone();
            let crawl_control_clone = crawl_control.clone();
            let app_handle_clone = app_handle.clone();
            let request_semaphore_clone = request_semaphore.clone();
            let request_throttle_clone = request_throttle.clone();
            let js_semaphore_clone = js_semaphore.clone();
            let image_metadata_checker_clone = image_metadata_checker.clone();
            let db_tx_clone = db_tx.clone();
            let persistence_error_clone = persistence_error_slot.clone();
            let settings_clone = settings.clone();

            crawl_tasks.spawn(async move {
                let url_str = normalize_url(url.as_str());
                let _task_guard = CrawlerState::enter_task(state_clone.clone(), url_str.clone());

                let result = process_url(
                    url.clone(),
                    depth,
                    &client_clone,
                    &base_url_clone,
                    state_clone.clone(),
                    &app_handle_clone,
                    &settings_clone,
                    request_semaphore_clone,
                    request_throttle_clone,
                    js_semaphore_clone,
                    image_metadata_checker_clone,
                    crawl_control_clone.clone(),
                )
                .await;

                let (activity_url, activity_detail, activity_kind) = match result {
                    Ok(processed) => {
                        if let Some(backoff) = processed.rate_limit {
                            let status = processed.final_result.status_code;
                            let _ = app_handle_clone.emit(
                                "crawl_rate_limited",
                                RateLimitedData {
                                    delay_ms: backoff.delay_ms,
                                    cooldown_ms: backoff.cooldown_ms,
                                    status: if matches!(status, 429 | 503) { status } else { 0 },
                                },
                            );
                        }

                        let mut persisted = true;
                        for row in processed
                            .redirect_results
                            .iter()
                            .chain(std::iter::once(&processed.final_result))
                        {
                            match to_database_results(row) {
                                Ok(db_result) => {
                                    if db_tx_clone.send(db_result).await.is_err() {
                                        let message = format!(
                                            "Database writer stopped before {} was persisted",
                                            row.url
                                        );
                                        tracing::error!("{}", message);
                                        record_persistence_error(&persistence_error_clone, message);
                                        persisted = false;
                                        break;
                                    }
                                }
                                Err(error) => {
                                    let message = format!(
                                        "Failed to serialize crawl result {}: {}",
                                        row.url, error
                                    );
                                    tracing::error!("{}", message);
                                    record_persistence_error(&persistence_error_clone, message);
                                    persisted = false;
                                    break;
                                }
                            }
                        }

                        // Persistence first, then state. `process_url` used to
                        // mark the URL crawled and emit progress before the rows
                        // reached the writer, so a Stop or timeout during channel
                        // backpressure aborted this task with the UI already
                        // counting a URL that SQLite never received.
                        if persisted {
                            update_state_and_emit_progress(
                                &state_clone,
                                &url,
                                depth,
                                &processed.final_result,
                                &processed.redirect_results,
                                processed.links_for_crawler.clone(),
                                &app_handle_clone,
                                &settings_clone,
                            )
                            .await;
                        }

                        (
                            processed.final_result.url.clone(),
                            format!("HTTP {}", processed.final_result.status_code),
                            "fetching".to_string(),
                        )
                    }
                    Err(error) if error == "Crawl stopped by user" => {
                        return;
                    }
                    Err(error) => {
                        tracing::error!("Failed to process {}: {}", url_str, error);

                        // The scheduler can hold a redirect source and its target
                        // at the same time. If the source already followed the
                        // redirect and wrote a real row for this exact URL, then
                        // recording a failure here would overwrite that row and
                        // count the URL twice — once crawled, once failed —
                        // pushing progress past 100%. Whoever accounted for it
                        // first wins.
                        if !state_clone.lock().await.try_claim_failure(&url_str) {
                            tracing::debug!(
                                "Discarding failure for {}: already accounted by another task",
                                url_str
                            );
                            return;
                        }

                        let failure = failed_crawl_result(
                            &url,
                            &base_url_clone,
                            depth,
                            error.clone(),
                        );
                        if let Ok(db_result) = to_database_results(&failure) {
                            if db_tx_clone.send(db_result).await.is_err() {
                                let message = format!(
                                    "Database writer stopped before failure row {} was persisted",
                                    url_str
                                );
                                tracing::error!("{}", message);
                                record_persistence_error(&persistence_error_clone, message);
                            }
                        } else {
                            let message = format!("Failed to serialize failure row {}", url_str);
                            tracing::error!("{}", message);
                            record_persistence_error(&persistence_error_clone, message);
                        }

                        let mut state_guard = state_clone.lock().await;
                        state_guard.pending_urls.remove(&url_str);
                        state_guard.last_activity = Instant::now();
                        let is_new = state_guard.visited.insert(url_str.clone());
                        state_guard.record_failure(FailedUrl {
                            url: url_str.clone(),
                            error: error.clone(),
                            retries: settings_clone.max_retries as usize,
                            depth,
                            timestamp: Instant::now(),
                        });
                        if is_new && state_guard.crawled_urls + state_guard.total_failed_count <= settings_clone.max_urls_stored {
                            state_guard.pending_results.push(LightCrawlResult::from_full(&failure));
                        }
                        (url.to_string(), error, "error".to_string())
                    }
                };

                let (queued, active, crawled) = {
                    let guard = state_clone.lock().await;
                    (guard.queue.len(), guard.active_tasks, guard.crawled_urls)
                };
                let _ = app_handle_clone.emit(
                    "crawl_activity",
                    &CrawlActivity {
                        kind: activity_kind,
                        url: activity_url,
                        detail: activity_detail,
                        queued,
                        active,
                        crawled,
                    },
                );
            });
        }

        if crawl_start_time.elapsed() > Duration::from_secs(crawl_timeout) {
            end_reason = "timeout".to_string();
            end_detail = format!("مهلت کلی کراول پس از {} ثانیه تمام شد", crawl_timeout);
            tracing::info!("Crawl timeout reached, terminating...");
            app_handle.emit("crawl_interrupted", ()).unwrap_or_default();
            break;
        }

        // Fill an under-capacity pipeline immediately. Once it is full, wake
        // on worker completion instead of imposing a fixed scheduler tick;
        // this keeps batch_size=1 from becoming an accidental 20 req/s cap.
        let can_fill_now = {
            let guard = state.lock().await;
            !guard.queue.is_empty() && guard.active_tasks < worker_capacity
        };
        if can_fill_now {
            tokio::task::yield_now().await;
        } else if !crawl_tasks.is_empty() {
            tokio::select! {
                join_result = crawl_tasks.join_next() => {
                    if let Some(Err(error)) = join_result {
                        record_worker_panic(&error, &mut worker_panic);
                    }
                }
                _ = sleep(Duration::from_millis(50)) => {}
            }
        } else {
            tokio::task::yield_now().await;
        }
    }

    // Any non-normal exit is terminal. Abort network futures immediately,
    // wait until every task is gone, then repair the in-memory counters before
    // flushing the database and emitting the final state.
    if end_reason != "finished" {
        crawl_tasks.abort_all();
    }
    while let Some(join_result) = crawl_tasks.join_next().await {
        if let Err(error) = join_result {
            record_worker_panic(&error, &mut worker_panic);
        }
    }
    // A worker can still panic during the final drain, after the main loop has
    // already settled on "finished". That URL has no row, so the crawl is not a
    // clean success and must not be reported as one.
    if end_reason == "finished" {
        if let Some(panic_detail) = worker_panic.clone() {
            end_reason = "worker_error".to_string();
            end_detail = panic_detail;
            let _ = app_handle.emit("crawl_interrupted", ());
        }
    }
    if end_reason != "finished" {
        let mut state_guard = state.lock().await;
        state_guard.queue.clear();
        state_guard.queued_url_set.clear();
        state_guard.pending_urls.clear();
        state_guard.active_urls.clear();
        state_guard.active_tasks = 0;
    }

    // Final cleanup and status report
    {



        let state_guard = state.lock().await;
        tracing::info!("Crawl completed - Final stats:");
        tracing::info!("  Total URLs discovered: {}", state_guard.total_urls);
        tracing::info!("  URLs successfully crawled: {}", state_guard.crawled_urls);
        tracing::info!("  URLs failed (total): {}", state_guard.total_failed_count);
        tracing::info!("  URLs failed (retained): {}", state_guard.failed_urls.len());
        tracing::info!("  URLs still pending: {}", state_guard.pending_urls.len());
        tracing::info!("  Active tasks remaining: {}", state_guard.active_tasks);
        tracing::info!("  Unique URL patterns: {}", state_guard.url_patterns.len());

        // Calculate final completion percentage
        let completed = state_guard.crawled_urls + state_guard.total_failed_count;
        let final_percentage = if state_guard.total_urls > 0 {
            (completed as f32 / state_guard.total_urls as f32) * 100.0
        } else {
            0.0
        };
        tracing::info!("  Final completion: {:.2}%", final_percentage);
    }

    // Flush any remaining buffered crawl results before completing
    {
        let mut state_guard = state.lock().await;
        if !state_guard.pending_results.is_empty() {
            let result_data = super::state::CrawlResultData {
                results: state_guard.pending_results.drain(..).collect(),
            };
            if let Err(err) = app_handle.emit("crawl_result", result_data) {
                eprintln!("Failed to emit final crawl result batch: {}", err);
            }
        }
    }

    drop(db_tx);
    if let Some(handle) = db_handle {
        match handle.await {
            Ok(Ok(persisted_rows)) => {
                tracing::info!("Database writer committed {} crawl rows", persisted_rows);
            }
            Ok(Err(error)) => {
                record_persistence_error(&persistence_error_slot, error);
            }
            Err(error) => {
                record_persistence_error(
                    &persistence_error_slot,
                    format!("Database writer task failed: {}", error),
                );
            }
        }
    }
    if let Some(error) = persistence_error(&persistence_error_slot) {
        let _ = app_handle.emit("crawl_interrupted", ());
        let _ = app_handle.emit(
            "crawl_activity",
            &CrawlActivity {
                kind: "persistence_error".to_string(),
                url: String::new(),
                detail: error.clone(),
                queued: 0,
                active: 0,
                crawled: state.lock().await.crawled_urls,
            },
        );
        return Err(error);
    }

    // Internal target status is authoritative only after all primary GET rows
    // are committed. Reconcile deferred internal LinkStatus objects before any
    // whole-crawl analysis, snapshot or completion event sees the database.
    if let Ok(db) = &db {
        match db.reconcile_internal_link_statuses().await {
            Ok(updated) => tracing::info!(
                "Reconciled {} internal-link statuses from primary crawl rows",
                updated
            ),
            Err(error) => {
                let message = format!(
                    "Failed to reconcile internal-link statuses: {}",
                    error
                );
                tracing::error!("{}", message);
                let _ = app_handle.emit("crawl_interrupted", ());
                return Err(message);
            }
        }
    }

    // Crawl Analysis: Link Score. Runs automatically at the end of every crawl when
    // enabled in Settings, and must complete before `crawl_complete` is emitted below
    // so the frontend's post-crawl refetch already sees the persisted scores.
    if settings.link_score_enabled {
        if let Ok(db) = &db {
            match db.get_link_score_inputs().await {
                Ok(all_pages) => {
                    let scores = super::link_score::compute_link_scores(&all_pages);
                    if let Err(e) = db.store_link_scores(scores).await {
                        tracing::error!("Failed to persist link scores: {}", e);
                    }
                }
                Err(e) => tracing::error!("Failed to load crawl data for link score: {}", e),
            }
        }
    }

    // Emit final 100% progress update before completion
    let final_progress = {
        let state_guard = state.lock().await;
        // Include in-flight URLs (pending_urls) that didn't finish before stall/timeout triggered.
        // Without this, stall-terminated crawls report e.g. 97% even though crawl_complete fires.
        let pending_at_end = state_guard.pending_urls.len();
        let completed = state_guard.crawled_urls + state_guard.total_failed_count + pending_at_end;
        let mut all_robots_blocked = robots_blocked.clone();
        all_robots_blocked.extend(state_guard.robots_blocked_urls.iter().cloned());
        all_robots_blocked.sort_unstable();
        all_robots_blocked.dedup();
        let progress = ProgressData {
            total_urls: std::cmp::max(state_guard.total_urls, 1),
            crawled_urls: completed,
            percentage: if state_guard.total_urls > 0 {
                (completed as f32 / state_guard.total_urls as f32) * 100.0
            } else {
                100.0
            },
            failed_urls_count: state_guard.total_failed_count,
            discovered_urls: std::cmp::max(state_guard.total_urls, 1),
            robots_blocked: Some(all_robots_blocked),
        };

        tracing::info!(
            "Final crawl stats: {} total processed ({} succeeded, {} failed, {} pending at end)",
            completed,
            state_guard.crawled_urls,
            state_guard.total_failed_count,
            pending_at_end
        );

        // Say why the crawl ended before reporting it as complete.
        let _ = app_handle.emit(
            "crawl_activity",
            &CrawlActivity {
                kind: end_reason.clone(),
                url: String::new(),
                detail: if end_detail.is_empty() {
                    format!(
                        "{} صفحه کراول شد، {} ناموفق",
                        state_guard.crawled_urls, state_guard.total_failed_count
                    )
                } else {
                    end_detail.clone()
                },
                queued: state_guard.queue.len(),
                active: state_guard.active_tasks,
                crawled: state_guard.crawled_urls,
            },
        );

        if let Err(err) = app_handle.emit("progress_update", progress.clone()) {
            eprintln!("Failed to emit final progress update: {}", err);
        }

        progress
    };

    if let Err(e) = database::create_diff_tables() {
        eprintln!("Failed to create diff tables: {}", e);
    }

    if let Err(e) = database::clone_batched_crawl_into_persistent_db().await {
        eprintln!("Failed to clone batched crawl into persistent db: {}", e);
    }

    // --- RECORD HISTORY (Backend-driven) ---
    if let Ok(db) = &db {
        // Idempotent — ensures the table (and any newly-added columns) exist
        // even if the user has never opened the Dashboard/History tab yet,
        // which is otherwise the only place this migration gets triggered.
        if let Err(e) = super::db_deep::db::create_domain_results_table() {
            tracing::error!("Failed to prepare history table before recording: {}", e);
        }
        match db.get_summary_stats().await {
            Ok(stats) => {
                let history_date = chrono::Local::now().to_rfc3339();
                let history_entry = super::db_deep::db::DeepCrawlHistory {
                    id: 0, // Auto-increment
                    domain: domain.to_string(),
                    date: history_date.clone(),
                    pages: stats["pages"].as_i64().unwrap_or(0) as i32,
                    errors: stats["errors"].as_i64().unwrap_or(0) as i32,
                    status: end_reason.clone(),
                    total_links: stats["total_links"].as_i64().unwrap_or(0) as i32,
                    total_internal_links: stats["total_internal_links"].as_i64().unwrap_or(0) as i32,
                    total_external_links: stats["total_external_links"].as_i64().unwrap_or(0) as i32,
                    indexable_pages: stats["indexable_pages"].as_i64().unwrap_or(0) as i32,
                    not_indexable_pages: stats["not_indexable_pages"].as_i64().unwrap_or(0) as i32,
                    total_css: stats["total_css"].as_i64().unwrap_or(0) as i32,
                    total_javascript: stats["total_javascript"].as_i64().unwrap_or(0) as i32,
                    total_images: stats["total_images"].as_i64().unwrap_or(0) as i32,
                    total_redirects: stats["total_redirects"].as_i64().unwrap_or(0) as i32,
                    missing_title: stats["missing_title"].as_i64().unwrap_or(0) as i32,
                    missing_description: stats["missing_description"].as_i64().unwrap_or(0) as i32,
                    avg_response_time: stats["avg_response_time"].as_i64().unwrap_or(0) as i32,
                    max_crawl_depth: stats["max_crawl_depth"].as_i64().unwrap_or(0) as i32,
                    total_secure_pages: stats["total_secure_pages"].as_i64().unwrap_or(0) as i32,
                    total_schema_pages: stats["total_schema_pages"].as_i64().unwrap_or(0) as i32,
                    total_mobile_pages: stats["total_mobile_pages"].as_i64().unwrap_or(0) as i32,
                    missing_h1: stats["missing_h1"].as_i64().unwrap_or(0) as i32,
                    missing_canonical: stats["missing_canonical"].as_i64().unwrap_or(0) as i32,
                    thin_content_pages: stats["thin_content_pages"].as_i64().unwrap_or(0) as i32,
                    noindex_pages: stats["noindex_pages"].as_i64().unwrap_or(0) as i32,
                    mixed_content_pages: stats["mixed_content_pages"].as_i64().unwrap_or(0) as i32,
                    cookies_pages: stats["cookies_pages"].as_i64().unwrap_or(0) as i32,
                    avg_word_count: stats["avg_word_count"].as_i64().unwrap_or(0) as i32,
                    avg_readability: stats["avg_readability"].as_i64().unwrap_or(0) as i32,
                    avg_page_size_kb: stats["avg_page_size_kb"].as_i64().unwrap_or(0) as i32,
                    duplicate_titles: stats["duplicate_titles"].as_i64().unwrap_or(0) as i32,
                    duplicate_descriptions: stats["duplicate_descriptions"].as_i64().unwrap_or(0) as i32,
                    status_2xx: stats["status_2xx"].as_i64().unwrap_or(0) as i32,
                    status_3xx: stats["status_3xx"].as_i64().unwrap_or(0) as i32,
                    status_4xx: stats["status_4xx"].as_i64().unwrap_or(0) as i32,
                    status_5xx: stats["status_5xx"].as_i64().unwrap_or(0) as i32,
                };
                
                match super::db_deep::db::create_domain_results_history(vec![history_entry]) {
                    Ok(ids) => {
                        if let Some(history_id) = ids.first() {
                            match database::create_crawl_snapshot(
                                *history_id,
                                domain.to_string(),
                                history_date,
                            )
                            .await
                            {
                                Ok(page_count) => tracing::info!(
                                    "Stored full snapshot {} with {} pages",
                                    history_id,
                                    page_count
                                ),
                                Err(error) => tracing::error!(
                                    "History summary was saved but full snapshot failed: {}",
                                    error
                                ),
                            }
                        }
                    }
                    Err(e) => eprintln!("Failed to record history in backend: {}", e),
                }
            }
            Err(e) => eprintln!("Failed to get summary stats for history: {}", e),
        }
    }

    // Completion means the rows, history summary and full snapshot are all on
    // disk. Emitting earlier created a race where the UI opened a history row
    // before its snapshot transaction had committed.
    app_handle
        .emit("crawl_complete", final_progress)
        .unwrap_or_default();
    tracing::info!("Crawl completed and persisted.");

    Ok(())
}
