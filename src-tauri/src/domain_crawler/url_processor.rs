//! URL processing logic for the domain crawler

use reqwest::Client;
use scraper::Html;
use serde_json::Value;
use std::sync::Arc;
use std::time::Instant;
use tauri::Emitter;
use tokio::sync::{Mutex, Semaphore};
use tokio::task;
use tokio::time::Duration;
use url::Url;

use crate::domain_crawler::extractors::html::{perform_extraction, update_cache};
use crate::domain_crawler::helpers::cookies;
use crate::domain_crawler::helpers::extract_url_pattern::extract_url_pattern;
use crate::domain_crawler::helpers::fetch_with_exponential::{
    fetch_with_exponential_backoff, sleep_with_control,
};
use crate::domain_crawler::helpers::request_throttle::{BackoffState, CrawlThrottle};
use crate::domain_crawler::helpers::https_checker::valid_https;
use crate::domain_crawler::helpers::normalize_url::normalize_url;
use crate::domain_crawler::helpers::skip_url::should_skip_url;
use crate::domain_crawler::helpers::opengraph;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::domain_crawler::helpers::headless_fetch;
use crate::settings::settings::Settings;

use super::helpers::canonical_selector::get_canonical;
use super::helpers::cross_origin::analyze_cross_origin_security;
use super::helpers::flesch_reader::get_flesch_score;
use super::helpers::hreflang_selector::select_hreflang;
use super::helpers::pagination_selector::select_pagination;
use super::helpers::content_encoding;
use super::helpers::page_meta::extract_page_meta;
use super::helpers::html_size_calculator::calculate_html_size;
use super::helpers::keyword_selector::extract_keywords;
use super::helpers::language_selector::detect_language;
use super::helpers::links_status_code_checker::get_links_status_code_from_settings;
use super::helpers::meta_robots_selector::{get_meta_robots, MetaRobots};
use super::helpers::text_ratio::{get_text_ratio, TextRatio};
use super::helpers::{
    alt_tags, anchor_links, check_html_page, forms_selector,
    content_signature::compute_content_signature, css_selector, headings_selector,
    iframe_selector, images_selector, indexability, javascript_selector, links_selector,
    mobile_checker, ngrams, page_description, schema_selector, title_selector,
    word_count::{get_sentence_count, get_word_count},
};
use super::models::{DomainCrawlResults, RedirectHop};
use super::page_speed::bulk::fetch_psi_bulk;
use super::state::{CrawlResultData, CrawlerState, ProgressData, RobotsFetchStage};

/// First backoff before re-reading a body, doubling per attempt. A host that
/// truncated one response is usually a moment from recovering, so this starts
/// short rather than punishing the whole crawl for one bad connection.
const BODY_RETRY_BASE_MS: u64 = 400;

pub struct ProcessedUrl {
    pub final_result: DomainCrawlResults,
    pub redirect_results: Vec<DomainCrawlResults>,
    pub rate_limit: Option<BackoffState>,
    /// Links discovered on this page, handed back so the worker can commit
    /// queue discovery and UI progress only after the database has accepted
    /// every row for this URL.
    pub links_for_crawler: std::collections::HashSet<Url>,
}

/// Process a single URL and extract all relevant data.
/// Redirect hops are returned as independent rows instead of being collapsed
/// into (and overwriting) their final 200 destination.
pub async fn process_url(
    url: Url,
    depth: usize,
    client: &Client,
    base_url: &Url,
    state: Arc<Mutex<CrawlerState>>,
    app_handle: &tauri::AppHandle,
    settings: &Settings,
    request_semaphore: Arc<Semaphore>,
    request_throttle: Arc<CrawlThrottle>,
    js_semaphore: Arc<Semaphore>,
    image_metadata_checker: Arc<images_selector::ImageMetadataChecker>,
    // Shared crawl-control flag: 0 run, 1 pause, 2 stop.
    crawl_control: Arc<std::sync::atomic::AtomicU8>,
) -> Result<ProcessedUrl, String> {
    use std::sync::atomic::Ordering as ControlOrdering;

    // Bail before doing any work if the user has already stopped the crawl —
    // otherwise a task spawned a moment earlier still costs a full fetch.
    if crawl_control.load(ControlOrdering::Relaxed) == 2 {
        return Err("Crawl stopped by user".to_string());
    }
    // Grab the global URL status registry early so we can record our results later.
    // This brief lock just clones the Arc, then drops the state lock immediately.
    let url_status_registry = {
        let state_guard = state.lock().await;
        state_guard.url_status_registry.clone()
    };

    let mut current_url = url.clone();
    let mut redirect_chain = Vec::new();
    let mut followed_redirects = 0usize;
    let mut had_redirect = false;
    let mut terminal_warning = None;
    let mut final_fetch = None;
    let mut total_time = 0.0;
    let mut rate_limit = None;

    // List mode disables robots in CrawlerState. In spider mode, resolve the
    // start origin before issuing even the first page request.
    CrawlerState::ensure_allowed_by_robots(&state, &current_url, RobotsFetchStage::Initial)
        .await?;

    // Follow redirects manually to track every response and enforce the policy
    // of each target's exact origin before fetching it.
    loop {
        let response_result = fetch_with_exponential_backoff(
            client,
            current_url.as_str(),
            settings,
            Some(&crawl_control),
            &request_semaphore,
            &request_throttle,
        )
        .await;

        match response_result {
            // The user stopped mid-fetch: unwind without recording a failure,
            // so a stopped crawl does not look like a broken one.
            Ok(None) => {
                return Err("Crawl stopped by user".to_string());
            }
            Ok(Some(fetch)) => {
                total_time += fetch.request_seconds;
                rate_limit = fetch.rate_limit.or(rate_limit);
                let response = &fetch.response;
                let status = response.status();
                let status_code = status.as_u16();

                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| current_url.join(value).ok())
                    .map(|url| url.to_string());
                let hop_content_type = response
                    .headers()
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);

                redirect_chain.push(RedirectHop {
                    url: current_url.to_string(),
                    status_code,
                    location: location.clone(),
                    content_type: hop_content_type,
                    response_time: Some(fetch.request_seconds),
                });

                if status.is_redirection() {
                    had_redirect = true;

                    let Some(next_url_string) = location else {
                        terminal_warning = Some(format!(
                            "HTTP {} redirect did not include a valid Location header",
                            status_code
                        ));
                        final_fetch = Some(fetch);
                        break;
                    };
                    if redirect_chain
                        .iter()
                        .any(|hop| normalize_url(&hop.url) == normalize_url(&next_url_string))
                    {
                        terminal_warning = Some(format!(
                            "Redirect loop detected at {}",
                            next_url_string
                        ));
                        final_fetch = Some(fetch);
                        break;
                    }
                    if followed_redirects >= settings.redirect_policy {
                        terminal_warning = Some(format!(
                            "Redirect follow limit ({}) reached before {}",
                            settings.redirect_policy,
                            next_url_string
                        ));
                        final_fetch = Some(fetch);
                        break;
                    }
                    if crawl_control.load(ControlOrdering::Acquire) == 2 {
                        return Err("Crawl stopped by user".to_string());
                    }
                    let next_url = Url::parse(&next_url_string)
                        .map_err(|error| format!("Invalid redirect target: {error}"))?;
                    if let Err(error) = CrawlerState::ensure_allowed_by_robots(
                        &state,
                        &next_url,
                        RobotsFetchStage::Redirect,
                    )
                    .await
                    {
                        // The source 3xx is a real HTTP response. Persist it as
                        // the terminal row with this warning instead of losing
                        // it behind a synthetic status-0 failure.
                        terminal_warning = Some(error);
                        final_fetch = Some(fetch);
                        break;
                    }
                    // The scheduler may already be fetching this exact target
                    // from its own queue entry. Following it here as well would
                    // issue a duplicate GET and write two competing rows for the
                    // same URL, with the survivor decided by write order. The
                    // source 3xx is still a real response and is recorded here.
                    if CrawlerState::redirect_target_already_handled(&state, &next_url).await {
                        terminal_warning = Some(format!(
                            "Redirect target {} is already being crawled; recorded the {} here",
                            next_url, status_code
                        ));
                        final_fetch = Some(fetch);
                        break;
                    }
                    current_url = next_url;
                    followed_redirects += 1;
                    drop(fetch);
                    continue;
                }
                final_fetch = Some(fetch);
                break;
            }
            Err(e) => {
                return Err(format!("Failed to fetch {}: {}", url, e));
            }
        }
    }

    let final_fetch = final_fetch.ok_or_else(|| "Failed to get response".to_string())?;
    let response = final_fetch.response;
    let network_permit = final_fetch.permit;
    let response_time = total_time;

    let final_url = response.url().clone();
    let status_code = response.status().as_u16();
    let redirect_count = count_redirect_hops(&redirect_chain);

    let final_location = last_redirect_location(&redirect_chain);
    let final_is_redirect = (300..400).contains(&status_code);
    let (final_had_redirect, redirect_url, final_redirection_type) =
        terminal_redirect_fields(status_code, final_location);

    // Log redirects occasionally for debugging (sampled to avoid performance hit)
    if had_redirect && rand::random_range(0..50) == 0 {
        // ~2% sampling rate
        tracing::info!(
            "Redirect: {} -> {} (status: {}, hops: {})",
            url,
            final_url,
            status_code,
            redirect_count
        );
    }

    // check if the url is https or not
    let https = valid_https(&final_url);

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .map(String::from);

    let http_version = format!("{:?}", response.version())
        .replace("HTTP/", "");

    let headers = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect::<Vec<_>>();

    let mut cookies_data = cookies::extract_cookies(&response);
    let declared_content_length = response.content_length().unwrap_or(0) as usize;

    // Register status codes the moment they are known, before any early return.
    // Redirect terminals, 204/304 and non-HTML resources all return below, and
    // body download can fail out too. A URL missing from the registry looks
    // unknown to the link checker, which then re-requests it over the network.
    //
    // DashMap allows concurrent inserts without blocking. The cap keeps memory
    // bounded on very large crawls.
    const MAX_REGISTRY_SIZE: usize = 200_000;
    if url_status_registry.len() < MAX_REGISTRY_SIZE {
        for hop in &redirect_chain {
            url_status_registry.insert(hop.url.clone(), hop.status_code);
        }
        // `status_code` belongs to the response we actually received, so it maps
        // to the final URL. The requested URL only shares it when no redirect
        // happened — otherwise its own 3xx is already recorded in the chain.
        url_status_registry.insert(final_url.to_string(), status_code);
        if !final_had_redirect {
            url_status_registry.insert(url.to_string(), status_code);
        }
    }

    // Resources are first-class crawl rows. Do not download a large PDF/image
    // merely to prove it is not HTML, and never turn a valid HTTP response into
    // a synthetic crawler failure.
    if final_is_redirect
        || matches!(status_code, 204 | 304)
        || is_definitely_non_html(content_type.as_deref())
    {
        drop(network_permit);
        let mut result = minimal_resource_result(
            &url,
            &final_url,
            base_url,
            depth,
            status_code,
            content_type.clone(),
            declared_content_length,
            response_time,
            headers,
            cookies_data,
            redirect_url,
            redirect_chain.clone(),
            redirect_count,
        );
        result.had_redirect = final_had_redirect;
        result.redirection_type = final_redirection_type.clone();
        apply_terminal_warning(&mut result, terminal_warning.as_deref());
        if content_type
            .as_deref()
            .is_some_and(|value| value.to_ascii_lowercase().contains("pdf"))
        {
            result.pdf_files.push(final_url.to_string());
        }
        let redirect_results = build_redirect_results(
            &redirect_chain,
            &result.url,
            base_url,
            depth,
        );
        return Ok(ProcessedUrl {
            final_result: result,
            redirect_results,
            rate_limit,
            links_for_crawler: Default::default(),
        });
    }

    // Bytes as they arrived, before decompression. This is the only point in
    // the crawl where that number exists, so it is captured here and carried
    // to page_meta rather than recomputed later from something that isn't it.
    let mut transferred_bytes: Option<usize> = None;

    // Reading the body is a second thing that can fail after the request has
    // already succeeded, and it used to have no retry at all: one connection
    // closed mid-body and the URL was recorded as permanently failed. That is
    // what all 27 failures of an 810-page websima.com crawl were — the same
    // pages fetch fine one at a time, so a truncated body is the host giving
    // up under load, not a page that cannot be read.
    //
    // The destination is already resolved by the redirect loop above, so
    // re-issuing a plain GET for it is safe: nothing about a GET changes state
    // and no redirect has to be re-followed.
    let mut body_attempt = 0u32;
    let mut response = response;
    let mut network_permit = network_permit;

    let mut body = loop {
        let outcome = tokio::time::timeout(
            Duration::from_secs(60), // 60s timeout for body download
            response.bytes(),
        )
        .await;

        let failure = match outcome {
            Ok(Ok(bytes)) => {
                drop(network_permit);
                transferred_bytes = Some(bytes.len());
                let encoding = headers
                    .iter()
                    .find(|(name, _)| name.eq_ignore_ascii_case("content-encoding"))
                    .map(|(_, value)| value.as_str())
                    .unwrap_or("");
                match content_encoding::decode_body(&bytes, encoding) {
                    Ok(decoded) => break String::from_utf8_lossy(&decoded).into_owned(),
                    Err(error) => {
                        // The bytes arrived intact and are still unreadable, so
                        // asking for them again would only produce the same
                        // thing. Reporting it beats parsing compressed noise as
                        // if it were HTML.
                        return Err(format!(
                            "Failed to decode {} body from {}: {}",
                            if encoding.is_empty() { "unencoded" } else { encoding },
                            url,
                            error
                        ));
                    }
                }
            }
            Ok(Err(error)) => format!("Failed to read response body: {}", error),
            Err(_) => format!("Timeout reading response body from {}", url),
        };

        body_attempt += 1;
        if body_attempt > settings.body_read_attempts {
            return Err(failure);
        }

        let delay = Duration::from_millis(
            BODY_RETRY_BASE_MS.saturating_mul(2u64.saturating_pow(body_attempt - 1)),
        );
        tracing::debug!(
            "{} — retrying body read {}/{} in {:?}",
            failure,
            body_attempt,
            settings.body_read_attempts,
            delay
        );
        if !sleep_with_control(delay, Some(&crawl_control)).await {
            return Err("Crawl stopped by user".to_string());
        }

        let retry = fetch_with_exponential_backoff(
            client,
            final_url.as_str(),
            settings,
            Some(&crawl_control),
            &request_semaphore,
            &request_throttle,
        )
        .await;

        match retry {
            Ok(Some(fetch)) => {
                total_time += fetch.request_seconds;
                rate_limit = fetch.rate_limit.or(rate_limit);
                network_permit = fetch.permit;
                response = fetch.response;
            }
            // The request itself is now failing too; the earlier body error is
            // the more informative of the two.
            Ok(None) => return Err("Crawl stopped by user".to_string()),
            Err(_) => return Err(failure),
        }
    };

    // A challenge page is still a real HTTP response. Persist the real 200 and
    // its headers/body size as a non-indexable row, while activating adaptive
    // cooldown, instead of manufacturing a status-0 transport failure.
    if status_code == 200 {
        if let Some(challenge) = suspected_challenge(&body) {
            let warning = format!(
                "Suspected anti-bot challenge ({}) for {}. Try lowering concurrency.",
                challenge,
                final_url
            );
            tracing::warn!("{}", warning);
            rate_limit = Some(request_throttle.on_rate_limited(None));
            let mut result = minimal_resource_result(
                &url,
                &final_url,
                base_url,
                depth,
                status_code,
                content_type.clone(),
                body.len(),
                response_time,
                headers,
                cookies_data,
                redirect_url,
                redirect_chain.clone(),
                redirect_count,
            );
            result.had_redirect = final_had_redirect;
            result.redirection_type = final_redirection_type.clone();
            mark_suspected_challenge(&mut result, warning);
            let redirect_results = build_redirect_results(
                &redirect_chain,
                &result.url,
                base_url,
                depth,
            );
            return Ok(ProcessedUrl {
                final_result: result,
                redirect_results,
                rate_limit,
                links_for_crawler: Default::default(),
            });
        }
    }

    // If Javascript Rendering is enabled and content is HTML, re-fetch via Headless Chrome
    if settings.javascript_rendering
        && check_html_page::is_html_page(&body, content_type.as_deref()).await
    {
        let js_url = final_url.to_string();
        let js_semaphore_clone = js_semaphore.clone();

        // Use a separate task for blocking IO of headless chrome, protected by semaphore
        let js_fetch_future = async move {
            // Acquire permit asynchronously
            let _permit = js_semaphore_clone
                .acquire()
                .await
                .map_err(|e| e.to_string())?;

            // Run blocking Chrome operation
            // Run blocking Chrome operation with a timeout
            {
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                {
                    tokio::time::timeout(
                        Duration::from_secs(45), // 45s timeout for JS rendering
                        task::spawn_blocking(move || headless_fetch::fetch_js_body(&js_url))
                    ).await
                        .map_err(|e| e.to_string())? // Outer timeout error
                        .map_err(|e| e.to_string())? // Inner spawn_blocking error
                }
                // No Chrome on phones: skip JS rendering and keep the raw HTML.
                #[cfg(any(target_os = "android", target_os = "ios"))]
                {
                    let _ = js_url;
                    Err::<(String, Vec<String>), String>(
                        "JS rendering is not available on mobile".to_string(),
                    )
                }
            }
        };

        match js_fetch_future.await {
            Ok((js_body, js_cookies)) => {
                if js_body.len() > 200 {
                    body = js_body;
                }
                // Merge JS cookies with existing cookies
                // We use a HashSet (implicitly by iterating) or just append and dedup?
                // Simple append is fine, the frontend can handle duplicates or we can dedup here if needed.
                // Let's dedup by name if possible, but "cookie=value" strings are opaque here.
                // Just appending is safer to avoid losing data.
                cookies_data.extend(js_cookies);

                // Deduplicate cookies
                cookies_data.sort();
                cookies_data.dedup();
            }
            Err(e) => {
                tracing::error!(
                    "Failed to render JS for {}: {}. Falling back to static content.",
                    final_url,
                    e
                );
            }
        }
    }

    let mut pdf_files: Vec<String> = Vec::new();
    // We want to try and extract whatever we can (titles, meta, etc.) from any 200 response.
    if content_type
        .as_deref()
        .map(|ct| ct.contains("pdf"))
        .unwrap_or(false)
    {
        pdf_files.push(url.to_string());
    }

    // Update the custom HTML extractor cache before parsing
    let _ = update_cache().await;

    // Perform all synchronous extractions in a scoped block to ensure `document` (non-Send)
    // is dropped before any `.await` points.
    let (
        title,
        description,
        headings,
        javascript_data,
        image_urls_for_fetch,
        internal_external_links,
        indexability_data,
        alt_tags_data,
        schema_data,
        css_data,
        iframe_data,
        word_count_val,
        sentence_count_val,
        mobile_val,
        canonicals_val,
        meta_robots_val,
        text_ratio_val,
        keywords_val,
        hreflangs_val,
        pagination_val,
        language_val,
        flesch_val,
        custom_search_matches_val,
        cross_origin_data,
        forms_val,
        links_for_crawler,
        _ngrams_data,
        opengraph_data,
        body_len,
        content_signature_val,
        page_meta_val,
    ) = {
        // Parse ngrams before moving `body` into the document parse (ngrams borrows body as &str).
        let ngrams_data_pre = if settings.extract_ngrams {
            ngrams::check_ngrams(&body, 2, url.as_str()).unwrap_or_default()
        } else {
            Vec::new()
        };

        let opengraph_data_pre = opengraph::parse_opengraph(&body);
        let body_len_pre = body.len();

        let document = Html::parse_document(&body);

        // Head metadata and response facts, read off the same document and the
        // headers we already collected — no extra request or parse.
        let page_meta_val =
            extract_page_meta(&document, &headers, &body, &http_version, transferred_bytes);

        // Explicitly drop `body` here so it's freed from memory before all the
        // async link-checking and image-fetching tasks that follow.
        // At 40K pages, keeping body alive until the end of process_url wastes GBs.
        drop(body);

        // Opt-in (Settings > Crawler > Duplicated Content Check): fingerprints body text
        // and headings so the Duplicate Content dashboard tab can cluster similar pages
        // later, purely from these cached hashes — no re-parsing needed.
        let content_signature_val = if settings.duplicate_content_check_enabled {
            Some(compute_content_signature(&document))
        } else {
            None
        };

        // Flesch needs to know the language before it decides whether it can
        // say anything, so the detection happens first rather than inline.
        let detected_language = detect_language(&document);

        (
            title_selector::extract_title(&document),
            page_description::extract_page_description(&document).unwrap_or_default(),
            headings_selector::headings_selector(&document),
            // Listing `<script src>` is an HTML read, exactly like the image
            // and stylesheet selectors beside it. It was gated behind
            // `javascript_rendering` — the Headless Chrome switch, off by
            // default — so a crawl that found all 66 images and all 8
            // stylesheets of a site reported zero JavaScript files. Rendering
            // is a separate question from which scripts a page references.
            javascript_selector::extract_javascript(&document, &final_url),
            images_selector::extract_image_urls_and_alts(&document, &final_url),
            anchor_links::extract_internal_external_links(&document, &final_url, base_url),
            indexability::extract_indexability_with_context(
                &document,
                status_code,
                &headers,
                Some(&final_url),
            ),
            alt_tags::get_alt_tags(&document),
            schema_selector::get_schema(&document),
            css_selector::extract_css(&document, &final_url),
            iframe_selector::extract_iframe(&document),
            get_word_count(&document),
            get_sentence_count(&document),
            mobile_checker::is_mobile(&document),
            get_canonical(&document).map(|c| c.canonicals),
            get_meta_robots(&document).unwrap_or(MetaRobots {
                meta_robots: Vec::new(),
            }),
            get_text_ratio(&document),
            extract_keywords(&document, &settings.stop_words),
            select_hreflang(&document),
            select_pagination(&document),
            detected_language.clone(),
            get_flesch_score(&document, detected_language.as_deref()),
            perform_extraction(&document),
            analyze_cross_origin_security(&document, &final_url),
            forms_selector::extract_forms(&document, &final_url),
            links_selector::extract_links(&document, &final_url, base_url),
            ngrams_data_pre,
            opengraph_data_pre,
            body_len_pre,
            content_signature_val,
            page_meta_val,
        )
    }; // `document` is dropped here

    let link_checker = {
        let state_guard = state.lock().await;
        state_guard.link_checker.clone()
    };

    let settings_clone = settings.clone();
    let internal_external_links_clone = internal_external_links.clone();
    let base_url_clone = base_url.clone();
    let final_url_str = final_url.to_string();
    let image_urls_for_fetch_clone = image_urls_for_fetch.clone();
    let psi_settings_clone = settings.clone();

    // Perform asynchronous checks in parallel
    let (check_links_status_code, images_details, psi_results): (
        super::helpers::links_status_code_checker::LinkCheckResults,
        Result<Vec<(String, String, u64, String, u16, bool)>, String>,
        Result<Vec<Value>, String>,
    ) = tokio::join!(
        async {
            if let Some(checker) = link_checker {
                checker
                    .check_links(
                        internal_external_links_clone,
                        &base_url_clone,
                        final_url_str,
                    )
                    .await
            } else {
                get_links_status_code_from_settings(
                    internal_external_links_clone,
                    &base_url_clone,
                    final_url_str,
                    &settings_clone,
                )
                .await
            }
        },
        images_selector::fetch_image_details(
            image_metadata_checker.clone(),
            image_urls_for_fetch_clone,
        ),
        async {
            if psi_settings_clone.page_speed_bulk {
                // Awaited inline on purpose. `tokio::spawn` here produced a task
                // that outlived its parent: aborting this worker (Stop, timeout)
                // only cancelled the join, leaving the PSI request running
                // detached and still consuming network and quota.
                let url_clone = final_url.clone();
                fetch_psi_bulk(url_clone, &psi_settings_clone).await
            } else {
                Ok(Vec::new())
            }
        }
    );

    // PARSES THE COOKIE DATA

    let result = DomainCrawlResults {
        url: final_url.to_string(),
        original_url: url.to_string(),
        redirect_url,
        had_redirect: final_had_redirect,
        redirection_type: final_redirection_type,
        redirect_chain: Some(redirect_chain.clone()),
        redirect_count,
        title,
        description,
        headings,
        javascript: javascript_data,
        images: images_details,
        status_code,
        anchor_links: internal_external_links,
        inoutlinks_status_codes: check_links_status_code,
        indexability: indexability_data,
        alt_tags: alt_tags_data,
        schema: schema_data,
        css: css_data,
        iframe: iframe_data,
        word_count: word_count_val,
        sentence_count: sentence_count_val,
        response_time: Some(response_time),
        mobile: mobile_val,
        canonicals: canonicals_val,
        meta_robots: meta_robots_val,
        opengraph: opengraph_data,
        content_type: content_type.unwrap_or_else(|| "Unknown".to_string()),
        content_length: body_len,
        text_ratio: Some(vec![text_ratio_val.and_then(|mut v| v.pop()).unwrap_or(
            TextRatio {
                html_length: 0,
                text_length: 0,
                text_ratio: 0.0,
            },
        )]),
        redirection: None,
        keywords: keywords_val,
        page_size: calculate_html_size(Some(body_len)),
        hreflangs: hreflangs_val,
        pagination: pagination_val,
        page_meta: page_meta_val,
        language: language_val,
        flesch: flesch_val,
        psi_results,
        custom_search: custom_search_matches_val,
        headers,
        pdf_files,
        https,
        cross_origin: cross_origin_data,
        forms: forms_val,
        status: Some(status_code),
        url_depth: Some(depth),
        cookies: Ok(cookies_data),
        content_simhash: content_signature_val.map(|s| s.content_simhash),
        heading_hash: content_signature_val.and_then(|s| s.heading_hash),
        crawl_error: terminal_warning,
    };

    let redirect_results = build_redirect_results(
        &redirect_chain,
        &result.url,
        base_url,
        depth,
    );

    // State, queue discovery and UI progress are deliberately NOT committed
    // here. The worker does that once the database writer has accepted every
    // row, so an abort during channel backpressure cannot leave the UI showing
    // a crawled URL that SQLite never received.
    Ok(ProcessedUrl {
        final_result: result,
        redirect_results,
        rate_limit,
        links_for_crawler,
    })
}

fn count_redirect_hops(redirect_chain: &[RedirectHop]) -> usize {
    redirect_chain
        .iter()
        .filter(|hop| (300..400).contains(&hop.status_code))
        .count()
}

fn last_redirect_location(redirect_chain: &[RedirectHop]) -> Option<String> {
    redirect_chain
        .iter()
        .rev()
        .find(|hop| (300..400).contains(&hop.status_code))
        .and_then(|hop| hop.location.clone())
}

fn terminal_redirect_fields(
    status_code: u16,
    location: Option<String>,
) -> (bool, Option<String>, Option<String>) {
    let is_redirect = (300..400).contains(&status_code);
    (
        is_redirect,
        is_redirect.then_some(location).flatten(),
        is_redirect.then(|| format!("{} Redirect", status_code)),
    )
}

fn mark_suspected_challenge(result: &mut DomainCrawlResults, warning: String) {
    result.crawl_error = Some(warning);
    result.indexability = indexability::Indexability {
        indexability: 0.0,
        indexability_reason:
            "Not indexable: suspected anti-bot challenge returned HTTP 200".to_string(),
    };
}

fn apply_terminal_warning(result: &mut DomainCrawlResults, warning: Option<&str>) {
    result.crawl_error = warning.map(str::to_string);
}

/// Classify short, known anti-bot responses without treating an ordinary long
/// page that happens to discuss rate limiting as a challenge.
fn suspected_challenge(body: &str) -> Option<&'static str> {
    let prefix = &body[..body.floor_char_boundary(25_000)];
    let prefix_lower = prefix.to_lowercase();
    if body.len() < 25_000 {
        if prefix_lower.contains("error 1015") {
            return Some("Cloudflare error 1015");
        }
        if prefix_lower.contains("error 1020") {
            return Some("Cloudflare error 1020");
        }
        if prefix_lower.contains("challenge-form") {
            return Some("challenge form");
        }
        if prefix_lower.contains("cloudflare") && prefix_lower.contains("ray id") {
            return Some("Cloudflare Ray ID block");
        }
        if prefix_lower.contains("distilnetworks") {
            return Some("Distil Networks block");
        }
        if prefix_lower.contains("please enable js") {
            return Some("JavaScript anti-bot challenge");
        }
    }

    if body.len() < 2_000 {
        let short_lower = body.to_lowercase();
        if short_lower.contains("access denied") {
            return Some("access denied");
        }
        if short_lower.contains("too many requests") || short_lower.contains("rate limit") {
            return Some("rate limit");
        }
        if short_lower.contains("one more step") {
            return Some("one more step challenge");
        }
        if short_lower.contains("unusual traffic") {
            return Some("unusual traffic challenge");
        }
        if short_lower.contains("bot detection") {
            return Some("bot detection challenge");
        }
    }
    None
}

fn is_definitely_non_html(content_type: Option<&str>) -> bool {
    let Some(content_type) = content_type else {
        return false;
    };
    let media_type = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    !matches!(
        media_type.as_str(),
        "text/html" | "application/xhtml+xml" | "text/plain"
    )
}

#[allow(clippy::too_many_arguments)]
fn minimal_resource_result(
    requested_url: &Url,
    final_url: &Url,
    base_url: &Url,
    depth: usize,
    status_code: u16,
    content_type: Option<String>,
    content_length: usize,
    response_time: f64,
    headers: Vec<(String, String)>,
    cookies: Vec<String>,
    redirect_url: Option<String>,
    redirect_chain: Vec<RedirectHop>,
    redirect_count: usize,
) -> DomainCrawlResults {
    let mut result = DomainCrawlResults::default();
    result.url = final_url.to_string();
    result.original_url = requested_url.to_string();
    result.status_code = status_code;
    result.status = Some(status_code);
    result.content_type = content_type.unwrap_or_else(|| "Unknown".to_string());
    result.content_length = content_length;
    result.page_size = calculate_html_size(Some(content_length));
    result.response_time = Some(response_time);
    result.headers = headers;
    result.cookies = Ok(cookies);
    result.https = valid_https(final_url);
    result.url_depth = Some(depth);
    result.redirect_url = redirect_url;
    result.had_redirect = (300..400).contains(&status_code);
    result.redirection_type = result
        .had_redirect
        .then_some(format!("{} Redirect", status_code));
    result.redirect_chain = Some(redirect_chain);
    result.redirect_count = redirect_count;
    result.indexability = indexability::extract_resource_indexability(
        status_code,
        &result.headers,
        &result.content_type,
        Some(final_url),
    );
    result.inoutlinks_status_codes.page = result.url.clone();
    result.inoutlinks_status_codes.base_url = base_url.clone();
    result
}

fn build_redirect_results(
    redirect_chain: &[RedirectHop],
    final_result_url: &str,
    base_url: &Url,
    depth: usize,
) -> Vec<DomainCrawlResults> {
    let final_key = normalize_url(final_result_url);
    let redirect_count = count_redirect_hops(redirect_chain);

    redirect_chain
        .iter()
        .filter(|hop| (300..400).contains(&hop.status_code))
        // If following stopped on a redirect (limit, loop, or no Location),
        // the final result itself is already the row for this URL.
        .filter(|hop| normalize_url(&hop.url) != final_key)
        .filter_map(|hop| {
            let hop_url = Url::parse(&hop.url).ok()?;
            let mut row = minimal_resource_result(
                &hop_url,
                &hop_url,
                base_url,
                depth,
                hop.status_code,
                hop.content_type.clone(),
                0,
                hop.response_time.unwrap_or_default(),
                Vec::new(),
                Vec::new(),
                hop.location.clone(),
                redirect_chain.to_vec(),
                redirect_count,
            );
            row.indexability.indexability_reason =
                format!("Not indexable: HTTP redirect {}", hop.status_code);
            Some(row)
        })
        .collect()
}

/// Update crawler state and emit progress after processing a URL
pub(crate) async fn update_state_and_emit_progress(
    state: &Arc<Mutex<CrawlerState>>,
    url: &Url,
    depth: usize,
    result: &DomainCrawlResults,
    redirect_results: &[DomainCrawlResults],
    links_for_crawler: std::collections::HashSet<Url>,
    app_handle: &tauri::AppHandle,
    settings: &Settings,
) {
    // Configuration > Include / Exclude, compiled once and cached by pattern
    // text so this costs a hash lookup per page rather than a regex rebuild.
    let url_filters = crate::domain_crawler::helpers::url_filters::cached(
        &settings.include_patterns,
        &settings.exclude_patterns,
    );

    // Pre-compute everything that doesn't need the lock — string normalization and
    // pattern extraction are CPU work that would otherwise inflate lock hold time
    // under high concurrency (50+ tasks all fighting for the same mutex).
    let normalized_current_url = normalize_url(url.as_str());
    let normalized_final_url = normalize_url(&result.url);

    // Pre-filter and normalize links before touching shared state.
    // Each entry: (normalized_url_string, pattern_string, parsed_Url)
    let prepared_links: Vec<(String, String, Url)> = links_for_crawler
        .into_iter()
        .filter_map(|link| {
            let link_str = link.as_str();
            if should_skip_url(link_str) {
                return None;
            }
            let normalized = normalize_url(link_str);
            let pattern = extract_url_pattern(&normalized);
            let url_obj = Url::parse(&normalized).ok()?;
            Some((normalized, pattern, url_obj))
        })
        .collect();

    // Origin-specific robots checks may perform metadata I/O. Resolve them
    // before taking the crawler-state lock so the queue is never locked across
    // an HTTP request. List mode intentionally does not discover new URLs.
    let mut robots_allowed_links = Vec::with_capacity(prepared_links.len());
    if !settings.list_mode {
        for (normalized, pattern, url_obj) in prepared_links {
            if !url_filters.allows(&normalized) {
                continue;
            }
            if CrawlerState::ensure_allowed_by_robots(
                state,
                &url_obj,
                RobotsFetchStage::Discovered,
            )
            .await
            .is_ok()
            {
                robots_allowed_links.push((normalized, pattern, url_obj));
            }
        }
    }

    let mut state = state.lock().await;

    let is_new_final = !state.visited.contains(&normalized_final_url);
    let mut newly_crawled = std::collections::HashSet::new();
    let identity_urls = redirect_results
        .iter()
        .map(|row| normalize_url(&row.url))
        .chain(std::iter::once(normalized_final_url.clone()));

    for normalized in identity_urls {
        let was_accounted = normalized == normalized_current_url
            || state.visited.contains(&normalized)
            || state.queued_url_set.contains(&normalized)
            || state.pending_urls.contains_key(&normalized);
        if state.visited.insert(normalized.clone()) {
            state.crawled_urls += 1;
            newly_crawled.insert(normalized.clone());
            if !was_accounted {
                state.total_urls += 1;
            }
        }
        // A redirect may have reached a URL that is still in the frontier.
        // The scheduler checks `visited` before fetching it; removing this set
        // entry keeps membership accounting coherent until it is drained.
        state.queued_url_set.remove(&normalized);
    }

    state.pending_urls.remove(&normalized_current_url);
    state.last_activity = Instant::now();

    // Only process links if we haven't reached configured limits and this was a
    // newly discovered final page. A previous hard 50K frontier cap silently
    // discarded every link on large hub pages; bounded scheduling provides
    // backpressure without losing URLs.
    if is_new_final
        && depth < settings.max_depth
        && state.total_urls < settings.max_urls_per_domain
    {
        let links_found = robots_allowed_links.len();
        if links_found > 0 && state.crawled_urls % 100 == 0 {
            tracing::info!("Found {} links on {} at depth {}", links_found, url, depth);
        }
        for (normalized_url, url_pattern, normalized_url_obj) in robots_allowed_links {
            // queued_url_set covers "in queue"; pending_urls covers "actively fetching".
            // Checking both prevents double-queueing. Neither check is expensive:
            // queued_url_set is a HashSet and pending_urls is now small (≤ active tasks).
            if !state.visited.contains(&normalized_url)
                && !state.queued_url_set.contains(&normalized_url)
                && !state.pending_urls.contains_key(&normalized_url)
                && state.total_urls < settings.max_urls_per_domain
            {
                state.queue.push_back((normalized_url_obj, depth + 1));
                state.queued_url_set.insert(normalized_url.clone());
                state.total_urls += 1;
                // pending_urls is NOT inserted here; it is inserted in the main loop
                // when the URL is dequeued, keeping pending_urls small at all scales.
                state.record_url_pattern(url_pattern);
            }
        }
    }

    // Calculate progress - use a stable approach for dynamic crawling
    let completed_urls = state.crawled_urls + state.total_failed_count;
    let total_discovered = state.total_urls;
    let active_pending = state.active_tasks;

    // For progress calculation, use the total count of discovered URLs as the denominator
    let progress_denominator = std::cmp::max(total_discovered, 1);
    let percentage = {
        let base_progress = (completed_urls as f32 / progress_denominator as f32) * 100.0;
        // Cap at 99% during active crawling, only show 100% when truly complete
        if active_pending > 0 {
            base_progress.min(99.0)
        } else {
            base_progress.min(100.0)
        }
    };

    // Ensure we never send invalid data that could cause NaN in frontend
    let safe_total_discovered = progress_denominator;
    let safe_completed_urls = completed_urls;

    let progress = ProgressData {
        total_urls: safe_total_discovered,
        crawled_urls: safe_completed_urls,
        percentage,
        failed_urls_count: state.total_failed_count,
        discovered_urls: safe_total_discovered,
        robots_blocked: None,
    };

    // Debug logging for troubleshooting NaN issues
    if total_discovered == 0 || percentage.is_nan() {
        tracing::warn!(
            "Potential invalid progress data - total_discovered: {}, completed_urls: {}, percentage: {}",
            total_discovered, completed_urls, percentage
        );
    }

    // Log progress every 50 URLs for better tracking
    if state.crawled_urls % 50 == 0 || (active_pending == 0 && completed_urls > 0) {
        tracing::info!(
            "Progress: {}/{} URLs completed ({:.1}%), {} succeeded, {} failed, {} pending, {} active",
            completed_urls,
            total_discovered,
            percentage,
            state.crawled_urls,
            state.failed_urls.len(),
            state.pending_urls.len(),
            state.active_tasks
        );
    }

    let now = Instant::now();

    // Adaptive progress throttle based on crawl scale
    let progress_interval_ms = if total_discovered > 20000 {
        2000  // Very large crawls: emit every 2s
    } else if total_discovered > 10000 {
        1000  // Large crawls: emit every 1s
    } else {
        400   // Small crawls: emit every 400ms
    };

    let should_emit_progress =
        state.last_progress_emit.elapsed() > Duration::from_millis(progress_interval_ms) || active_pending == 0;

    if should_emit_progress && safe_total_discovered > 0 && !percentage.is_nan() {
        if let Err(err) = app_handle.emit("progress_update", progress) {
            eprintln!("Failed to emit progress update: {}", err);
        }
        state.last_progress_emit = now;
    } else {
        // Only log this debug message if we're not emitting due to invalid data,
        // not just because of throttling.
        if should_emit_progress && (safe_total_discovered == 0 || percentage.is_nan()) {
            tracing::warn!(
                "Skipping invalid progress update: total_discovered={}, percentage={}",
                safe_total_discovered, percentage
            );
        }
    }

    // Buffer results and emit in batches to avoid flooding the IPC bridge.
    // At 40K+ URLs, emitting per-URL would cause ~40K state updates and re-renders.
    // Adaptive thresholds: larger batches at scale to reduce IPC pressure.
    // The frontend JS heap is capped; SQLite remains the complete source of
    // truth. Emit every newly-created redirect row as well as the final row.
    if state.crawled_urls <= settings.max_urls_stored {
        for row in redirect_results.iter().chain(std::iter::once(result)) {
            if newly_crawled.contains(&normalize_url(&row.url)) {
                state
                    .pending_results
                    .push(super::models::LightCrawlResult::from_full(row));
            }
        }
    }

    let (batch_interval_ms, batch_size_threshold) = if total_discovered > 30000 {
        (5000, 600)  // Huge crawls (40K+ URLs): emit every 5s or 600 items — reduces IPC to ~12 events/min
    } else if total_discovered > 20000 {
        (3000, 500)  // Very large crawls: emit every 3s or 500 items
    } else if total_discovered > 10000 {
        (2000, 250)  // Large crawls: emit every 2s or 250 items
    } else if total_discovered > 5000 {
        (1000, 100)  // Medium crawls: emit every 1s or 100 items
    } else {
        (500, 50)    // Small crawls: emit every 500ms or 50 items
    };

    let should_emit_results = state.last_result_emit.elapsed() > Duration::from_millis(batch_interval_ms)
        || state.pending_results.len() >= batch_size_threshold
        || active_pending == 0; // Flush on completion

    if should_emit_results && !state.pending_results.is_empty() {
        // Drain results and update the emit timestamp BEFORE dropping the lock.
        // This is critical: if we drop the lock first, we can never update last_result_emit,
        // which means the batch throttle is completely bypassed and every single URL
        // triggers an IPC emit (the original bug causing UI freezes at 15K+ URLs).
        let result_data = CrawlResultData {
            results: state.pending_results.drain(..).collect(),
        };
        // ✅ CRITICAL FIX: update timestamp BEFORE dropping so the throttle works
        state.last_result_emit = Instant::now();
        drop(state); // Release lock before IPC call to avoid holding mutex during serialization
        if let Err(err) = app_handle.emit("crawl_result", result_data) {
            eprintln!("Failed to emit crawl result batch: {}", err);
        }
        return;
    }

    // progress info already logged above

    // Enhanced periodic status logging
    if state.crawled_urls % 50 == 0 {
        tracing::info!(
            "Status - Crawled: {}, Pending: {}, Queue: {}, Failed: {}, Patterns: {}",
            state.crawled_urls,
            state.pending_urls.len(),
            state.queue.len(),
            state.failed_urls.len(),
            state.url_patterns.len()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_terminal_warning, count_redirect_hops, last_redirect_location,
        mark_suspected_challenge, suspected_challenge, terminal_redirect_fields,
    };
    use crate::domain_crawler::models::{DomainCrawlResults, RedirectHop};

    fn hop(status_code: u16, location: Option<&str>) -> RedirectHop {
        RedirectHop {
            url: format!("https://example.com/{status_code}"),
            status_code,
            location: location.map(str::to_string),
            content_type: None,
            response_time: None,
        }
    }

    #[test]
    fn redirect_count_includes_terminal_redirects_and_excludes_final_200() {
        let completed = vec![
            hop(301, Some("https://example.com/two")),
            hop(302, Some("https://example.com/final")),
            hop(200, None),
        ];
        assert_eq!(count_redirect_hops(&completed), 2);
        assert_eq!(
            last_redirect_location(&completed).as_deref(),
            Some("https://example.com/final")
        );

        let terminal = vec![hop(308, None)];
        assert_eq!(count_redirect_hops(&terminal), 1);
        assert_eq!(last_redirect_location(&terminal), None);
    }

    #[test]
    fn terminal_redirect_warning_preserves_the_source_3xx_row() {
        let mut result = DomainCrawlResults::default();
        result.status_code = 302;
        result.status = Some(302);
        apply_terminal_warning(
            &mut result,
            Some("Blocked by robots.txt before redirect fetch"),
        );

        assert_eq!(result.status_code, 302);
        assert_eq!(result.status, Some(302));
        assert_eq!(
            result.crawl_error.as_deref(),
            Some("Blocked by robots.txt before redirect fetch")
        );
    }

    #[test]
    fn final_200_keeps_redirect_provenance_without_being_a_redirect_row() {
        let chain = vec![
            hop(301, Some("https://example.com/middle")),
            hop(302, Some("https://example.com/final")),
            hop(200, None),
        ];
        let (had_redirect, redirect_url, redirection_type) =
            terminal_redirect_fields(200, last_redirect_location(&chain));

        assert_eq!(count_redirect_hops(&chain), 2);
        assert!(!had_redirect);
        assert_eq!(redirect_url, None);
        assert_eq!(redirection_type, None);

        let (had_redirect, redirect_url, redirection_type) = terminal_redirect_fields(
            302,
            Some("https://example.com/blocked-target".to_string()),
        );
        assert!(had_redirect);
        assert_eq!(
            redirect_url.as_deref(),
            Some("https://example.com/blocked-target")
        );
        assert_eq!(redirection_type.as_deref(), Some("302 Redirect"));
    }

    #[test]
    fn challenge_detection_is_specific_and_does_not_flag_long_editorial_pages() {
        assert_eq!(
            suspected_challenge("<html>Cloudflare block; Ray ID: abc</html>"),
            Some("Cloudflare Ray ID block")
        );
        let editorial = format!(
            "<html><article>{}</article><p>access denied is an HTTP phrase</p></html>",
            "ordinary SEO analysis ".repeat(2_000)
        );
        assert_eq!(suspected_challenge(&editorial), None);
    }

    #[test]
    fn challenge_annotation_preserves_the_real_http_200_identity() {
        let mut result = DomainCrawlResults::default();
        result.status_code = 200;
        result.status = Some(200);
        mark_suspected_challenge(&mut result, "challenge warning".to_string());

        assert_eq!(result.status_code, 200);
        assert_eq!(result.status, Some(200));
        assert_eq!(result.crawl_error.as_deref(), Some("challenge warning"));
        assert_eq!(result.indexability.indexability, 0.0);
        assert!(result
            .indexability
            .indexability_reason
            .contains("anti-bot challenge"));
    }
}
