use dashmap::DashMap;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

/// Maximum number of link-check results to cache before evicting the oldest half.
/// Prevents the status_cache from growing unboundedly across a 40K+ page crawl.
const MAX_STATUS_CACHE_SIZE: usize = 50_000;

/// How long (in seconds) a per-domain DomainTracker entry is considered stale.
/// Entries not accessed within this window are pruned to free memory.
const DOMAIN_TRACKER_TTL_SECS: u64 = 300; // 5 minutes

use futures::{stream, StreamExt};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, OnceCell, Semaphore};
use tokio::time::{sleep, timeout};

use crate::domain_crawler::helpers::anchor_links::InternalExternalLinks;
use crate::settings::settings::Settings;

#[derive(Debug, Clone)]
pub struct LinkCheckConfig {
    pub concurrent_requests: usize,
    pub min_delay_ms: u64,
    pub max_delay_ms: u64,
    pub max_retries: usize,
    pub request_timeout_secs: u64,
    pub jitter_factor: f32,
    pub max_requests_per_domain: usize,
    pub initial_task_capacity: usize,
    pub retry_delay_ms: u64,
    pub connection_timeout_secs: u64,
    pub pool_idle_timeout_secs: u64,
    pub pool_max_idle_per_host: usize,
}

impl From<&Settings> for LinkCheckConfig {
    fn from(settings: &Settings) -> Self {
        Self {
            // Zero cannot drive buffer_unordered or a Semaphore; every other value is
            // authoritative and must not be silently raised to a high concurrency.
            concurrent_requests: settings.links_max_concurrent_requests.max(1),
            // Retry backoff is not normal crawl pacing. Per-domain pacing starts at zero
            // and is enabled only after a genuine 429/503 response.
            min_delay_ms: 0,
            max_delay_ms: 0,
            max_retries: settings.links_max_retries,
            request_timeout_secs: settings.links_request_timeout,
            jitter_factor: settings.links_jitter_factor,
            max_requests_per_domain: settings.max_urls_per_domain,
            initial_task_capacity: settings.links_initial_task_capacity,
            retry_delay_ms: settings.links_retry_delay,
            connection_timeout_secs: settings.client_connect_timeout,
            pool_idle_timeout_secs: settings.links_pool_idle_timeout,
            pool_max_idle_per_host: settings.links_max_idle_per_host,
        }
    }
}

type CachedStatus = (Option<u16>, Option<String>);

/// A bounded FIFO cache. HashMap iteration order is not an age signal, so tracking
/// insertion order separately avoids arbitrary mass eviction and repeated shrink/grow
/// cycles during large crawls.
#[derive(Default)]
struct StatusCache {
    entries: HashMap<String, CachedStatus>,
    insertion_order: VecDeque<String>,
}

impl StatusCache {
    fn get(&self, key: &str) -> Option<CachedStatus> {
        self.entries.get(key).cloned()
    }

    fn insert(&mut self, key: String, value: CachedStatus) {
        self.insert_with_limit(key, value, MAX_STATUS_CACHE_SIZE);
    }

    fn insert_with_limit(&mut self, key: String, value: CachedStatus, limit: usize) {
        if limit == 0 {
            return;
        }

        if let Some(existing) = self.entries.get_mut(&key) {
            *existing = value;
            return;
        }

        while self.entries.len() >= limit {
            let Some(oldest) = self.insertion_order.pop_front() else {
                // Defensive recovery if the order index ever gets out of sync.
                self.entries.clear();
                break;
            };
            self.entries.remove(&oldest);
        }

        self.insertion_order.push_back(key.clone());
        self.entries.insert(key, value);
    }
}

impl LinkCheckConfig {
    pub fn from_settings(settings: &Settings) -> Self {
        Self::from(settings)
    }
}

pub struct SharedLinkChecker {
    client: Arc<Client>,
    domain_tracker: Arc<DomainTracker>,
    semaphore: Arc<Semaphore>,
    pub config: LinkCheckConfig,
    /// Global cache of link statuses: URL -> (StatusCode, Error)
    status_cache: Arc<Mutex<StatusCache>>,
    /// Per-URL single-flight cells. OnceCell has no lost-wakeup window: a waiter
    /// arriving after completion reads the initialized result immediately.
    in_flight: Arc<Mutex<HashMap<String, Arc<OnceCell<CachedStatus>>>>>,
    /// Global URL → HTTP status code registry shared with the crawler.
    /// URLs that the crawler has already visited are recorded here so the
    /// link checker can return their status instantly without an HTTP request.
    /// Uses DashMap to allow concurrent lock-free reads and writes.
    url_status_registry: Arc<DashMap<String, u16>>,
}

impl SharedLinkChecker {
    pub fn new(
        settings: &Settings,
        user_agent: Option<String>,
        url_status_registry: Arc<DashMap<String, u16>>,
    ) -> Self {
        let config = LinkCheckConfig::from_settings(settings);
        let client = build_client(&config, settings, user_agent);
        SharedLinkChecker {
            client: Arc::new(client),
            domain_tracker: Arc::new(DomainTracker::new(&config)),
            semaphore: Arc::new(Semaphore::new(config.concurrent_requests)),
            config,
            status_cache: Arc::new(Mutex::new(StatusCache::default())),
            in_flight: Arc::new(Mutex::new(HashMap::new())),
            url_status_registry,
        }
    }

    pub async fn check_links(
        &self,
        links: Option<InternalExternalLinks>,
        base_url: &Url,
        page: String,
    ) -> LinkCheckResults {
        let base_url_arc = Arc::new(base_url.clone());
        let page_arc = Arc::new(page);
        let seen_urls = Arc::new(StdMutex::new(HashSet::with_capacity(
            self.config.initial_task_capacity,
        )));

        let mut results = Vec::new();

        if let Some(links_data) = links {
            let links_iter = prepare_links(links_data);
            
            let mut stream = stream::iter(links_iter)
                .map(|(link, anchor, rel, title, target, is_internal)| {
                    let client = self.client.clone();
                    let semaphore = self.semaphore.clone();
                    let base_url_arc = base_url_arc.clone();
                    let page_arc = page_arc.clone();
                    let seen_urls = seen_urls.clone();
                    let domain_tracker = self.domain_tracker.clone();
                    let config = self.config.clone();
                    let status_cache = self.status_cache.clone();
                    let in_flight = self.in_flight.clone();
                    let url_status_registry = self.url_status_registry.clone();

                    async move {
                        process_single_link(
                            client,
                            semaphore,
                            base_url_arc,
                            page_arc,
                            seen_urls,
                            domain_tracker,
                            link,
                            anchor,
                            rel,
                            title,
                            target,
                            is_internal,
                            config,
                            status_cache,
                            in_flight,
                            url_status_registry,
                        )
                        .await
                    }
                })
                .buffer_unordered(self.config.concurrent_requests);

            while let Some(result) = stream.next().await {
                if let Some(res) = result {
                    results.push(res);
                }
            }
        }

        process_results(results, page_arc, base_url_arc)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinkStatus {
    pub base_url: Url,
    pub url: String,
    pub relative_path: Option<String>,
    pub status: Option<u16>,
    pub error: Option<String>,
    pub anchor_text: Option<String>,
    pub rel: Option<String>,
    pub title: Option<String>,
    pub target: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LinkCheckResults {
    pub page: String,
    pub base_url: Url,
    pub internal: Vec<LinkStatus>,
    pub external: Vec<LinkStatus>,
}

struct DomainTracker {
    last_request: StdMutex<HashMap<String, Instant>>,
    delays: StdMutex<HashMap<String, Duration>>,
    request_counts: StdMutex<HashMap<String, usize>>,
    config: LinkCheckConfig,
}

impl DomainTracker {
    fn new(config: &LinkCheckConfig) -> Self {
        DomainTracker {
            last_request: StdMutex::new(HashMap::with_capacity(64)),
            delays: StdMutex::new(HashMap::with_capacity(64)),
            request_counts: StdMutex::new(HashMap::with_capacity(64)),
            config: config.clone(),
        }
    }

    /// Remove per-domain entries that haven't been accessed within DOMAIN_TRACKER_TTL_SECS.
    /// Called periodically to prevent the tracker maps from growing indefinitely when
    /// crawling sites that link to many unique external domains.
    fn prune(&self) {
        let cutoff = Duration::from_secs(DOMAIN_TRACKER_TTL_SECS);
        let now = Instant::now();

        // Collect stale domains from last_request
        let stale_domains: Vec<String> = {
            let lr = self.last_request.lock().unwrap();
            lr.iter()
                .filter(|(_, &ts)| now.duration_since(ts) > cutoff)
                .map(|(k, _)| k.clone())
                .collect()
        };

        if !stale_domains.is_empty() {
            let mut lr = self.last_request.lock().unwrap();
            let mut dl = self.delays.lock().unwrap();
            let mut rc = self.request_counts.lock().unwrap();
            for domain in &stale_domains {
                lr.remove(domain);
                dl.remove(domain);
                rc.remove(domain);
            }
        }
    }

    fn get_delay_for(&self, domain: &str) -> Duration {
        let base_delay = {
            let delays = self.delays.lock().unwrap();
            delays
                .get(domain)
                .copied()
                .unwrap_or_default()
        };

        // There is deliberately no normal per-domain delay. links_retry_delay is
        // exclusively retry/backoff configuration, not a hidden crawl speed limit.
        if base_delay.is_zero() {
            return Duration::ZERO;
        }

        let mut last_requests = self.last_request.lock().unwrap();
        let now = Instant::now();
        let last_req = last_requests.entry(domain.to_string()).or_insert(now);

        let target_time = *last_req + base_delay;
        let wait_time = if now < target_time {
            target_time.duration_since(now)
        } else {
            Duration::ZERO
        };

        // Reserve this request's slot. A long server-driven backoff is waited out; it
        // must never be converted into a fabricated HTTP 429 result.
        *last_req = std::cmp::max(now, target_time);

        wait_time
    }

    fn update_delay_for(&self, domain: &str, response: &reqwest::Response) {
        let mut delays = self.delays.lock().unwrap();
        if response.status() == 429 || response.status() == 503 {
            let retry_after = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.trim().parse::<u64>().ok())
                .map(Duration::from_secs)
                .unwrap_or_default();
            let configured_backoff = Duration::from_millis(self.config.retry_delay_ms.max(1));
            let next = delays
                .get(domain)
                .copied()
                .map(|current| current.saturating_mul(2))
                .unwrap_or(configured_backoff)
                .max(retry_after)
                .min(Duration::from_secs(30));
            delays.insert(domain.to_string(), next);
            tracing::warn!(
                "Link checker: {} from {}, setting per-domain backoff to {:?}",
                response.status(),
                domain,
                next
            );
        } else if response.status().is_success() {
            if let Some(current) = delays.get(domain).copied() {
                let new_delay = current.mul_f32(0.75);
                if new_delay < Duration::from_millis(50) {
                    delays.remove(domain);
                } else {
                    delays.insert(domain.to_string(), new_delay);
                }
            }
        }
    }

    fn should_throttle(&self, domain: &str) -> bool {
        if self.config.max_requests_per_domain == 0 {
            return false;
        }
        let mut counts = self.request_counts.lock().unwrap();
        let count = counts.entry(domain.to_string()).or_insert(0);
        *count += 1;
        *count > self.config.max_requests_per_domain
    }

    fn record_request(&self, domain: &str) {
        let mut last_request = self.last_request.lock().unwrap();
        last_request.insert(domain.to_string(), Instant::now());
    }
}

pub async fn get_links_status_code(
    links: Option<InternalExternalLinks>,
    base_url: &Url,
    page: String,
    _config: LinkCheckConfig,
) -> LinkCheckResults {
    let settings = Settings::default(); // Fallback
    let checker = SharedLinkChecker::new(
        &settings,
        None,
        Arc::new(DashMap::new()),
    );
    checker.check_links(links, base_url, page).await
}

pub async fn get_links_status_code_from_settings(
    links: Option<InternalExternalLinks>,
    base_url: &Url,
    page: String,
    settings: &Settings,
) -> LinkCheckResults {
    let checker = SharedLinkChecker::new(
        settings,
        None,
        Arc::new(DashMap::new()),
    );
    checker.check_links(links, base_url, page).await
}

fn build_client(config: &LinkCheckConfig, settings: &Settings, user_agent: Option<String>) -> Client {
    let configured_user_agent = user_agent
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| settings.http_user_agent.trim().to_string());

    Client::builder()
        .timeout(Duration::from_secs(config.request_timeout_secs))
        .connect_timeout(Duration::from_secs(config.connection_timeout_secs))
        .pool_idle_timeout(Duration::from_secs(config.pool_idle_timeout_secs))
        .pool_max_idle_per_host(config.pool_max_idle_per_host)
        .user_agent(configured_user_agent)
        .redirect(reqwest::redirect::Policy::limited(settings.redirect_policy))
        .danger_accept_invalid_certs(false)
        .build()
        .expect("Failed to create HTTP client")
}

fn prepare_links(
    links_data: InternalExternalLinks,
) -> impl Iterator<
    Item = (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        bool,
    ),
> {
    links_data
        .internal
        .links
        .into_iter()
        .zip(links_data.internal.anchors.into_iter())
        .zip(links_data.internal.rels.into_iter())
        .zip(links_data.internal.titles.into_iter())
        .zip(links_data.internal.targets.into_iter())
        .map(|((((link, anchor), rel), title), target)| (link, anchor, rel, title, target, true))
        .chain(
            links_data
                .external
                .links
                .into_iter()
                .zip(links_data.external.anchors.into_iter())
                .zip(links_data.external.rels.into_iter())
                .zip(links_data.external.titles.into_iter())
                .zip(links_data.external.targets.into_iter())
                .map(|((((link, anchor), rel), title), target)| {
                    (link, anchor, rel, title, target, false)
                }),
        )
}

fn status_cache_key(url: &Url) -> String {
    let mut normalized = url.clone();
    // Fragments are client-side document locations and never change the HTTP
    // resource being checked. Treating each fragment as a separate key causes
    // duplicate requests and inconsistent registry/cache hits.
    normalized.set_fragment(None);
    normalized.to_string()
}

async fn process_single_link(
    client: Arc<Client>,
    semaphore: Arc<Semaphore>,
    base_url: Arc<Url>,
    page: Arc<String>,
    seen_urls: Arc<StdMutex<HashSet<String>>>,
    domain_tracker: Arc<DomainTracker>,
    link: String,
    anchor: String,
    rel: Option<String>,
    title: Option<String>,
    target: Option<String>,
    is_internal: bool,
    config: LinkCheckConfig,
    status_cache: Arc<Mutex<StatusCache>>,
    in_flight: Arc<Mutex<HashMap<String, Arc<OnceCell<CachedStatus>>>>>,
    url_status_registry: Arc<DashMap<String, u16>>,
) -> Option<(LinkStatus, bool)> {
    let full_url = match if is_internal {
        base_url.join(&link)
    } else {
        Url::parse(&link)
    } {
        Ok(u) => u,
        Err(e) => {
            eprintln!("Skipping invalid URL '{}' on page '{}': {}", link, page, e);
            return None;
        }
    };

    let full_url_str = status_cache_key(&full_url);

    {
        let mut seen = seen_urls.lock().unwrap();
        if !seen.insert(full_url_str.clone()) {
            return None;
        }
    }

    // Skip non-HTTP(S) schemes but still report them as seen on this page
    let scheme = full_url.scheme();
    if scheme != "http" && scheme != "https" {
        return Some((
            LinkStatus {
                base_url: (*base_url).clone(),
                url: full_url_str,
                relative_path: is_internal.then(|| link),
                status: None,
                error: None,
                anchor_text: Some(anchor),
                rel,
                title,
                target,
            },
            is_internal,
        ));
    }

    // host_str covers both DNS names and IP literals; Url::domain() returns None
    // for IP hosts and would incorrectly merge all of them into one throttle bucket.
    let domain = full_url.host_str().unwrap_or("").to_ascii_lowercase();

    let relative_path = is_internal.then(|| link.clone());
    let anchor_text = Some(anchor.clone());

    // 1) Check the global URL status registry first (populated by the crawler)
    //    DashMap allows lock-free concurrent reads — no blocking.
    if let Some(status_code) = url_status_registry.get(&full_url_str).map(|r| *r) {
        let error = if status_code >= 400 {
            Some(format!("HTTP Error: {}", status_code))
        } else {
            None
        };
        return Some((
            LinkStatus {
                base_url: (*base_url).clone(),
                url: full_url_str,
                relative_path,
                status: Some(status_code),
                error,
                anchor_text,
                rel,
                title,
                target,
            },
            is_internal,
        ));
    }

    // 2) Check the link-checker's own status cache (populated by previous link checks)
    let cached_result = {
        let cache = status_cache.lock().await;
        cache.get(&full_url_str)
    };

    if let Some((status, error)) = cached_result {
        return Some((
            LinkStatus {
                base_url: (*base_url).clone(),
                url: full_url_str,
                relative_path,
                status,
                error,
                anchor_text,
                rel,
                title,
                target,
            },
            is_internal,
        ));
    }

    // Internal targets are already queued for the primary crawler, which performs
    // the authoritative GET and records redirects/content. Issuing a speculative
    // HEAD here doubles origin traffic and can race ahead of crawl discovery. Keep
    // the complete link record and reconcile its status from persisted crawl rows
    // after the crawl finishes. Registry/cache hits above remain immediately useful.
    if is_internal {
        return Some((
            LinkStatus {
                base_url: (*base_url).clone(),
                url: full_url_str,
                relative_path,
                status: None,
                error: None,
                anchor_text,
                rel,
                title,
                target,
            },
            true,
        ));
    }

    // A URL has one shared initializer at a time. Unlike Notify, OnceCell cannot
    // lose a wakeup between checking the cache and beginning to wait.
    let flight_cell = {
        let mut flight_map = in_flight.lock().await;
        flight_map
            .entry(full_url_str.clone())
            .or_insert_with(|| Arc::new(OnceCell::new()))
            .clone()
    };

    // Close the cache-miss/flight-registration race: the previous initializer may
    // have published and removed its cell between those two operations.
    if let Some(cached) = {
        let cache = status_cache.lock().await;
        cache.get(&full_url_str)
    } {
        let _ = flight_cell.set(cached);
    }

    let fetched = flight_cell
        .get_or_init(|| async {
            if domain_tracker.should_throttle(&domain) {
                return (
                    None,
                    Some("Throttled: Max requests per domain reached".to_string()),
                );
            }

            let result = fetch_with_retry(
                &client,
                &full_url_str,
                &domain,
                &domain_tracker,
                Arc::clone(&base_url),
                relative_path.clone(),
                anchor_text.clone(),
                rel.clone(),
                title.clone(),
                target.clone(),
                Arc::clone(&semaphore),
                &config,
            )
            .await;
            domain_tracker.record_request(&domain);
            (result.status, result.error)
        })
        .await
        .clone();

    // Publish the initialized value before removing the flight entry. A new caller
    // will therefore find either this cell or the completed cache entry.
    {
        let mut cache = status_cache.lock().await;
        cache.insert(full_url_str.clone(), fetched.clone());
    }

    // Periodically prune stale DomainTracker entries to prevent unbounded growth
    // when crawling pages that link to many unique external domains.
    // Use a simple modulo on the domain string's hash as a cheap probabilistic trigger.
    {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        domain.hash(&mut h);
        if h.finish() % 200 == 0 {
            domain_tracker.prune();
        }
    }

    {
        let mut flight_map = in_flight.lock().await;
        let is_same_cell = flight_map
            .get(&full_url_str)
            .is_some_and(|current| Arc::ptr_eq(current, &flight_cell));
        if is_same_cell {
            flight_map.remove(&full_url_str);
        }
    }

    Some((
        LinkStatus {
            base_url: (*base_url).clone(),
            url: full_url_str,
            relative_path,
            status: fetched.0,
            error: fetched.1,
            anchor_text,
            rel,
            title,
            target,
        },
        is_internal,
    ))
}

async fn fetch_with_retry(
    client: &Client,
    url: &str,
    domain: &str,
    domain_tracker: &DomainTracker,
    base_url: Arc<Url>,
    relative_path: Option<String>,
    anchor_text: Option<String>,
    rel: Option<String>,
    title: Option<String>,
    target: Option<String>,
    semaphore: Arc<Semaphore>,
    config: &LinkCheckConfig,
) -> LinkStatus {
    let mut attempt = 0;
    let mut last_error = None;

    loop {
        // Only genuine server-driven backoff contributes a per-domain delay.
        let delay = domain_tracker.get_delay_for(domain);
        if !delay.is_zero() {
            sleep(delay).await;
        }

        let permit = match Semaphore::acquire_owned(semaphore.clone()).await {
            Ok(p) => p,
            Err(e) => {
                tracing::error!("Link checker: Semaphore acquire failed for {}: {}", url, e);
                last_error = Some(format!("Semaphore acquire failed: {}", e));
                break;
            }
        };

        let request_result = timeout(
            Duration::from_secs(config.request_timeout_secs),
            try_head_then_get(client, url),
        )
        .await;
        // Never hold a scarce request permit while logging or sleeping for retry.
        drop(permit);

        match request_result {
            Ok(Ok(response)) => {
                domain_tracker.update_delay_for(domain, &response);
                return handle_success_response(
                    response,
                    base_url,
                    url,
                    relative_path,
                    anchor_text,
                    rel,
                    title,
                    target,
                );
            }
            Ok(Err(e)) => {
                let err_msg = e.to_string();
                if err_msg.contains("429") {
                    tracing::warn!("Link checker: 429 Too Many Requests for {}", url);
                } else {
                    // A dead external link is a finding we report, not a fault
                    // in this program. Logging it at ERROR buried genuine errors
                    // under 207 lines of noise on a single crawl.
                    tracing::debug!("Link checker: unreachable {}: {}", url, err_msg);
                }
                last_error = Some(err_msg);
            }
            Err(_) => {
                tracing::warn!("Link checker: Timeout for {}", url);
                last_error = Some("Request timeout".to_string());
            }
        }

        attempt += 1;
        if attempt >= config.max_retries {
            break;
        }

        // Exponential backoff with jitter
        let exponent = attempt.saturating_sub(1).min(20) as u32;
        let base_delay = config
            .retry_delay_ms
            .saturating_mul(1_u64 << exponent);
        let jitter =
            (base_delay as f32 * config.jitter_factor * rand::random_range(-1.0..1.0)) as i64;
        let delay = (base_delay as i64 + jitter).max(0) as u64;
        sleep(Duration::from_millis(delay)).await;
    }

    LinkStatus {
        base_url: (*base_url).clone(),
        url: url.to_string(),
        relative_path,
        status: None,
        error: last_error,
        anchor_text,
        rel,
        title,
        target,
    }
}

fn process_results(
    results: Vec<(LinkStatus, bool)>,
    page_arc: Arc<String>,
    base_url_arc: Arc<Url>,
) -> LinkCheckResults {
    let (mut internal_statuses, mut external_statuses) = (Vec::new(), Vec::new());

    for (status, is_internal) in results {
        if is_internal {
            internal_statuses.push(status);
        } else {
            external_statuses.push(status);
        }
    }

    LinkCheckResults {
        page: (*page_arc).clone(),
        base_url: (*base_url_arc).clone(),
        internal: internal_statuses,
        external: external_statuses,
    }
}

async fn try_head_then_get(
    client: &Client,
    url: &str,
) -> Result<reqwest::Response, reqwest::Error> {
    match client.head(url).send().await {
        Ok(head_response) if should_fallback_to_get(head_response.status()) => {
            match client.get(url).send().await {
                Ok(get_response) => Ok(get_response),
                // A real HEAD response is better evidence than discarding its status
                // because the GET fallback hit a transport error.
                Err(_) => Ok(head_response),
            }
        }
        Ok(response) => Ok(response),
        Err(_) => client.get(url).send().await,
    }
}

fn should_fallback_to_get(status: reqwest::StatusCode) -> bool {
    matches!(
        status,
        reqwest::StatusCode::FORBIDDEN
            | reqwest::StatusCode::METHOD_NOT_ALLOWED
            | reqwest::StatusCode::NOT_IMPLEMENTED
    )
}

fn handle_success_response(
    response: reqwest::Response,
    base_url: Arc<Url>,
    url: &str,
    relative_path: Option<String>,
    anchor_text: Option<String>,
    rel: Option<String>,
    title: Option<String>,
    target: Option<String>,
) -> LinkStatus {
    let status = response.status();
    LinkStatus {
        base_url: (*base_url).clone(),
        url: url.to_string(),
        relative_path,
        status: Some(status.as_u16()),
        error: if status.is_client_error() || status.is_server_error() {
            Some(format!("HTTP Error: {}", status))
        } else {
            None
        },
        anchor_text,
        rel,
        title,
        target,
    }
}

#[allow(dead_code)]
fn is_internal(url_to_check: &str, base_url: &Url) -> bool {
    Url::parse(url_to_check)
        .map(|parsed_url| {
            let base_domain = base_url.domain().unwrap_or("");
            let url_domain = parsed_url.domain().unwrap_or("");
            url_domain.ends_with(base_domain)
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain_crawler::helpers::anchor_links::{LinkTypes, LinksAnchors};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn serve_statuses(statuses: Vec<u16>) -> (String, tokio::task::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let mut requests = Vec::with_capacity(statuses.len());
            for status in statuses {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buffer = vec![0_u8; 8 * 1024];
                let read = timeout(Duration::from_secs(2), socket.read(&mut buffer))
                    .await
                    .unwrap()
                    .unwrap();
                requests.push(String::from_utf8_lossy(&buffer[..read]).into_owned());
                let response = format!(
                    "HTTP/1.1 {status} Test\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                );
                socket.write_all(response.as_bytes()).await.unwrap();
            }
            requests
        });
        (format!("http://{address}/resource"), task)
    }

    fn one_link(url: String, internal: bool) -> InternalExternalLinks {
        let empty = || LinksAnchors {
            links: Vec::new(),
            inlinks: LinkTypes {
                relative: Vec::new(),
                absolute: Vec::new(),
            },
            anchors: Vec::new(),
            rels: Vec::new(),
            titles: Vec::new(),
            targets: Vec::new(),
        };
        let populated = LinksAnchors {
                links: vec![url.clone()],
                inlinks: LinkTypes {
                    relative: Vec::new(),
                    absolute: vec![url],
                },
                anchors: vec!["link".to_string()],
                rels: vec![None],
                titles: vec![None],
                targets: vec![None],
            };
        if internal {
            InternalExternalLinks {
                internal: populated,
                external: empty(),
            }
        } else {
            InternalExternalLinks {
                internal: empty(),
                external: populated,
            }
        }
    }

    #[test]
    fn configured_concurrency_is_honored_and_only_zero_is_clamped() {
        let mut settings = Settings::default();
        settings.links_max_concurrent_requests = 7;
        let configured = LinkCheckConfig::from_settings(&settings);
        assert_eq!(configured.concurrent_requests, 7);
        assert_eq!(configured.min_delay_ms, 0);

        settings.links_max_concurrent_requests = 0;
        assert_eq!(LinkCheckConfig::from_settings(&settings).concurrent_requests, 1);
    }

    #[test]
    fn status_cache_is_bounded_and_evicts_oldest_entry() {
        let mut cache = StatusCache::default();
        cache.insert_with_limit("first".to_string(), (Some(200), None), 2);
        cache.insert_with_limit("second".to_string(), (Some(201), None), 2);
        cache.insert_with_limit("third".to_string(), (Some(202), None), 2);

        assert!(cache.get("first").is_none());
        assert_eq!(cache.get("second").unwrap().0, Some(201));
        assert_eq!(cache.get("third").unwrap().0, Some(202));
        assert_eq!(cache.entries.len(), 2);
    }

    #[test]
    fn cache_key_ignores_fragments_but_keeps_query_strings() {
        let first = Url::parse("https://EXAMPLE.com:443/path?q=1#first").unwrap();
        let second = Url::parse("https://example.com/path?q=1#second").unwrap();
        let different_query = Url::parse("https://example.com/path?q=2#first").unwrap();

        assert_eq!(status_cache_key(&first), status_cache_key(&second));
        assert_ne!(status_cache_key(&first), status_cache_key(&different_query));
        assert!(!status_cache_key(&first).contains('#'));
    }

    #[test]
    fn normal_requests_have_no_hidden_retry_spacing() {
        let mut settings = Settings::default();
        settings.links_retry_delay = 10_000;
        let tracker = DomainTracker::new(&LinkCheckConfig::from_settings(&settings));

        assert_eq!(tracker.get_delay_for("example.com"), Duration::ZERO);
        assert_eq!(tracker.get_delay_for("example.com"), Duration::ZERO);
    }

    #[tokio::test]
    async fn head_falls_back_to_get_and_sends_the_configured_user_agent() {
        let (url, server) = serve_statuses(vec![405, 204]).await;
        let mut settings = Settings::default();
        settings.http_user_agent = "ConfiguredCrawler/9.1".to_string();
        settings.links_request_timeout = 2;
        settings.client_connect_timeout = 2;
        let config = LinkCheckConfig::from_settings(&settings);
        let client = build_client(&config, &settings, None);

        let response = try_head_then_get(&client, &url).await.unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::NO_CONTENT);

        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].starts_with("HEAD /resource HTTP/1.1"));
        assert!(requests[1].starts_with("GET /resource HTTP/1.1"));
        assert!(requests[0]
            .to_ascii_lowercase()
            .contains("user-agent: configuredcrawler/9.1"));
    }

    #[tokio::test]
    async fn genuine_head_status_is_preserved_without_get() {
        let (url, server) = serve_statuses(vec![404]).await;
        let settings = Settings::default();
        let config = LinkCheckConfig::from_settings(&settings);
        let client = build_client(&config, &settings, None);

        let response = try_head_then_get(&client, &url).await.unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::NOT_FOUND);
        let requests = server.await.unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("HEAD /resource HTTP/1.1"));
    }

    #[tokio::test]
    async fn internal_cache_miss_is_recorded_without_a_network_request() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            timeout(Duration::from_millis(250), listener.accept())
                .await
                .is_ok() as usize
        });
        let url = format!("http://{address}/internal#section");
        let base_url = Url::parse(&format!("http://{address}/")).unwrap();
        let settings = Settings::default();
        let checker = SharedLinkChecker::new(&settings, None, Arc::new(DashMap::new()));

        let result = checker
            .check_links(
                Some(one_link(url, true)),
                &base_url,
                "source".to_string(),
            )
            .await;

        assert_eq!(result.internal.len(), 1);
        assert_eq!(result.internal[0].status, None);
        assert_eq!(result.internal[0].error, None);
        assert!(!result.internal[0].url.contains('#'));
        assert_eq!(server.await.unwrap(), 0);
    }

    #[tokio::test]
    async fn internal_registry_hit_resolves_status_without_a_network_request() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            timeout(Duration::from_millis(250), listener.accept())
                .await
                .is_ok() as usize
        });
        let url = format!("http://{address}/internal#section");
        let normalized = format!("http://{address}/internal");
        let base_url = Url::parse(&format!("http://{address}/")).unwrap();
        let registry = Arc::new(DashMap::new());
        registry.insert(normalized, 410);
        let settings = Settings::default();
        let checker = SharedLinkChecker::new(&settings, None, registry);

        let result = checker
            .check_links(
                Some(one_link(url, true)),
                &base_url,
                "source".to_string(),
            )
            .await;

        assert_eq!(result.internal[0].status, Some(410));
        assert_eq!(result.internal[0].error.as_deref(), Some("HTTP Error: 410"));
        assert_eq!(server.await.unwrap(), 0);
    }

    #[tokio::test]
    async fn concurrent_pages_single_flight_the_same_external_link() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut request_count = 0_usize;
            loop {
                let accepted = timeout(Duration::from_millis(350), listener.accept()).await;
                let Ok(Ok((mut socket, _))) = accepted else {
                    break;
                };
                request_count += 1;
                let mut buffer = vec![0_u8; 8 * 1024];
                let _ = socket.read(&mut buffer).await.unwrap();
                sleep(Duration::from_millis(75)).await;
                socket
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    )
                    .await
                    .unwrap();
            }
            request_count
        });

        let url = format!("http://{address}/shared#fragment");
        let base_url = Url::parse(&format!("http://{address}/")).unwrap();
        let links = one_link(url, false);
        let mut settings = Settings::default();
        settings.links_max_concurrent_requests = 4;
        settings.links_request_timeout = 2;
        settings.client_connect_timeout = 2;
        let checker = SharedLinkChecker::new(
            &settings,
            Some("SingleFlightTest/1.0".to_string()),
            Arc::new(DashMap::new()),
        );

        let (first, second) = tokio::join!(
            checker.check_links(Some(links.clone()), &base_url, "page-1".to_string()),
            checker.check_links(Some(links), &base_url, "page-2".to_string())
        );
        assert_eq!(first.external[0].status, Some(200));
        assert_eq!(second.external[0].status, Some(200));
        assert_eq!(server.await.unwrap(), 1);
    }
}
