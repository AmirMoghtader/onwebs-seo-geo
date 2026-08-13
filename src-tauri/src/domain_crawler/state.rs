//! Crawler state management types and structures

use dashmap::DashMap;
use serde::Serialize;
use std::collections::{HashMap, HashSet, VecDeque};
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use url::Url;

use super::constants::MAX_PENDING_TIME;
use super::database::{Database, DatabaseResults};
use super::helpers::links_status_code_checker::SharedLinkChecker;
use super::helpers::robots::{RobotsPolicy, RobotsPolicyCache};
use super::models::DomainCrawlResults;
use super::helpers::normalize_url::normalize_url;

/// Maximum number of failed URLs to retain. Once this cap is hit the oldest
/// failures are silently discarded to prevent the set from consuming memory
/// proportional to the number of errors on a large crawl.
const MAX_FAILED_URLS: usize = 10_000;

/// Maximum number of URL patterns to track. Patterns are used to detect
/// infinite URL traps; beyond this cap new patterns are simply not tracked.
const MAX_URL_PATTERNS: usize = 20_000;

/// The UI needs representative blocked URLs, not an unbounded copy of every
/// denied parameter variant found on a crawler trap.
const MAX_ROBOTS_BLOCKED_URLS: usize = 10_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RobotsFetchStage {
    Initial,
    Redirect,
    Discovered,
}

impl RobotsFetchStage {
    fn label(self) -> &'static str {
        match self {
            Self::Initial => "initial",
            Self::Redirect => "redirect",
            Self::Discovered => "discovered",
        }
    }
}

/// Track failed URLs and retries
#[derive(Clone)]
pub struct FailedUrl {
    pub url: String,
    pub error: String,
    pub retries: usize,
    pub depth: usize,
    pub timestamp: Instant,
}

// A URL can fail at several layers (transport, body, parsing), but it is still
// one failed crawl target. Timestamp and message must not turn retries of the
// same URL into multiple failures and corrupt completion percentages.
impl PartialEq for FailedUrl {
    fn eq(&self, other: &Self) -> bool {
        self.url == other.url
    }
}

impl Eq for FailedUrl {}

impl Hash for FailedUrl {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.url.hash(state);
    }
}

/// Progress tracking structure
#[derive(Clone, Serialize)]
pub struct ProgressData {
    pub total_urls: usize,
    pub crawled_urls: usize,
    pub percentage: f32,
    pub failed_urls_count: usize,
    pub discovered_urls: usize,
    pub robots_blocked: Option<Vec<String>>,
}

/// Crawl result structure for emitting events (batched)
#[derive(Clone, Serialize)]
pub struct CrawlResultData {
    pub results: Vec<super::models::LightCrawlResult>,
}

/// Structure to track crawler state
pub struct CrawlerState {
    pub visited: HashSet<String>,
    pub failed_urls: HashSet<FailedUrl>,
    /// Tracks URLs that have been **dequeued and are actively being fetched**.
    /// NOT used for queued-but-not-yet-fetched URLs — use `queued_url_set` for those.
    /// Keeping this small (≤ concurrent_requests * 2) is critical for performance:
    /// it is checked on every link during dedup and iterated in cleanup_stale_pending.
    pub pending_urls: HashMap<String, Instant>,
    pub queue: VecDeque<(Url, usize)>,          // Include depth tracking
    /// Mirror of `queue` as a set for O(1) membership tests and deduplication.
    /// Must be kept in sync: insert when pushing to queue, remove when draining.
    pub queued_url_set: HashSet<String>,
    pub total_urls: usize,
    pub crawled_urls: usize,
    pub total_failed_count: usize,
    pub db: Option<Database>,
    pub last_activity: Instant,        // Track last crawling activity
    pub url_patterns: HashMap<String, usize>, // Track URL patterns to avoid duplicates
    pub active_tasks: usize,           // Track number of currently processing tasks
    pub active_urls: HashSet<String>,  // Track URLs currently being processed
    pub link_checker: Option<Arc<SharedLinkChecker>>,
    pub last_progress_emit: Instant,   // Track time of last progress emission
    pub last_result_emit: Instant,     // Track time of last crawl_result batch emission
    pub pending_results: Vec<super::models::LightCrawlResult>, // Buffer for batching crawl_result events
    pub last_cleanup: Instant,         // Rate-limit cleanup_stale_pending calls
    /// Global URL → HTTP status code registry shared between the crawler and link checker.
    /// Populated by the crawler after fetching each page; read by the link checker to skip
    /// redundant HTTP requests for URLs whose status is already known.
    /// Uses DashMap (lock-free concurrent hashmap) to avoid blocking the async executor
    /// under high concurrency (many simultaneous inserts from 50+ tasks).
    pub url_status_registry: Arc<DashMap<String, u16>>,
    /// Legacy start-origin policy retained until callers migrate to
    /// `with_robots_cache`. It is never consulted for a cache miss because that
    /// would leak one origin's policy onto redirects/subdomains.
    pub robots_policy: RobotsPolicy,
    pub robots_cache: Option<Arc<RobotsPolicyCache>>,
    /// List mode keeps this false so it audits the explicit input exactly.
    pub respect_robots: bool,
    pub robots_blocked_urls: HashSet<String>,
}

impl CrawlerState {
    /// Whether another task is already producing the row for `url`, because it
    /// has been crawled or is actively being fetched by its own queue entry.
    ///
    /// A redirect source consults this before following its target. The
    /// scheduler already skips a queued URL that a redirect reached first
    /// (it checks `visited` at dequeue time); this closes the other direction,
    /// where the target's own fetch is already in flight and both tasks would
    /// otherwise write competing rows for it.
    ///
    /// This only reads state. It deliberately does not record a claim, because
    /// a claim that outlived its task would strand the URL — `cleanup_stale_pending`
    /// drops stale entries but never puts them back in the queue.
    pub async fn redirect_target_already_handled(
        state: &Arc<Mutex<CrawlerState>>,
        url: &Url,
    ) -> bool {
        let normalized =
            crate::domain_crawler::helpers::normalize_url::normalize_url(url.as_str());
        let guard = state.lock().await;
        guard.visited.contains(&normalized) || guard.pending_urls.contains_key(&normalized)
    }

    /// Claims the right to record a failure for `url`, clearing its pending entry.
    ///
    /// Returns `false` when the URL has already been accounted for — typically by
    /// a redirect source that resolved to this exact target while its own queue
    /// entry was still in flight. The caller must then drop its failure instead
    /// of overwriting the real row and counting the URL twice, once as crawled
    /// and once as failed, which pushes progress past 100%.
    pub fn try_claim_failure(&mut self, url: &str) -> bool {
        self.pending_urls.remove(url);
        self.last_activity = Instant::now();
        !self.visited.contains(url)
    }

    pub fn new(db: Option<Database>) -> Self {
        Self {
            visited: HashSet::new(),
            failed_urls: HashSet::new(),
            queued_url_set: HashSet::new(),
            pending_urls: HashMap::new(),
            queue: VecDeque::new(),
            total_urls: 0,
            crawled_urls: 0,
            total_failed_count: 0,
            db,
            last_activity: Instant::now(),
            url_patterns: HashMap::new(),
            active_tasks: 0,
            active_urls: HashSet::new(),
            link_checker: None,
            last_progress_emit: Instant::now(),
            last_result_emit: Instant::now(),
            pending_results: Vec::with_capacity(64),
            last_cleanup: Instant::now(),
            url_status_registry: Arc::new(DashMap::with_capacity(4096)),
            robots_policy: RobotsPolicy::default(),
            robots_cache: None,
            respect_robots: true,
            robots_blocked_urls: HashSet::new(),
        }
    }

    pub fn with_link_checker(mut self, link_checker: Arc<SharedLinkChecker>) -> Self {
        self.link_checker = Some(link_checker);
        self
    }

    pub fn with_url_status_registry(mut self, registry: Arc<DashMap<String, u16>>) -> Self {
        self.url_status_registry = registry;
        self
    }

    pub fn with_robots_policy(mut self, policy: RobotsPolicy, respect_robots: bool) -> Self {
        self.robots_policy = policy;
        self.respect_robots = respect_robots;
        self
    }

    pub fn with_robots_cache(
        mut self,
        cache: Arc<RobotsPolicyCache>,
        respect_robots: bool,
    ) -> Self {
        self.robots_cache = Some(cache);
        self.respect_robots = respect_robots;
        self
    }

    /// Resolve and enforce the exact-origin robots policy before network work.
    /// The state lock is released before metadata I/O, then reacquired only to
    /// retain a bounded blocked-URL sample.
    pub async fn ensure_allowed_by_robots(
        state: &Arc<Mutex<Self>>,
        url: &Url,
        stage: RobotsFetchStage,
    ) -> Result<(), String> {
        let (respect_robots, cache, legacy_policy) = {
            let guard = state.lock().await;
            (
                guard.respect_robots,
                guard.robots_cache.clone(),
                guard.robots_policy.clone(),
            )
        };

        if !respect_robots {
            return Ok(());
        }

        let allowed = match cache {
            Some(cache) => cache.is_allowed(url).await,
            None => legacy_policy.is_allowed(url.as_str()),
        };
        if allowed {
            return Ok(());
        }

        let mut guard = state.lock().await;
        guard.record_robots_block(url.as_str());
        Err(format!(
            "Blocked by robots.txt before {} fetch: {}",
            stage.label(),
            url
        ))
    }

    /// Return whether a URL may be queued and retain blocked discoveries for
    /// the UI/export rather than silently dropping them.
    pub fn allows_by_robots(&mut self, url: &str) -> bool {
        if !self.respect_robots {
            return true;
        }

        let parsed = Url::parse(url).ok();
        let allowed = match (&self.robots_cache, parsed.as_ref()) {
            (Some(cache), Some(url)) => cache.is_allowed_cached(url).unwrap_or(true),
            (Some(_), None) => true,
            (None, _) => self.robots_policy.is_allowed(url),
        };
        if !allowed {
            self.record_robots_block(url);
        }
        allowed
    }

    fn record_robots_block(&mut self, url: &str) {
        if self.robots_blocked_urls.len() < MAX_ROBOTS_BLOCKED_URLS
            || self.robots_blocked_urls.contains(url)
        {
            self.robots_blocked_urls.insert(url.to_string());
        }
    }

    /// Record a failed URL. Always increments `total_failed_count` even though
    /// the `failed_urls` set is periodically truncated to cap memory usage.
    /// Use this instead of inserting into `failed_urls` directly.
    pub fn record_failure(&mut self, failed: FailedUrl) {
        let is_new = self.failed_urls.insert(failed);
        if is_new {
            self.total_failed_count += 1;
        }
    }

    /// Track URL-shape statistics without using a heuristic to silently drop
    /// valid product/category pages. The map is diagnostic only and bounded.
    pub fn record_url_pattern(&mut self, pattern: String) {
        if let Some(count) = self.url_patterns.get_mut(&pattern) {
            *count = count.saturating_add(1);
        } else if self.url_patterns.len() < MAX_URL_PATTERNS {
            self.url_patterns.insert(pattern, 1);
        }
    }

    /// Clean up stale pending URLs and periodically compact collections to return
    /// memory to the OS. Called from the main crawler loop on every iteration.
    /// Rate-limited to every 10 seconds — pending_urls is small (only active fetches),
    /// so there is no point paying the retain + shrink overhead on every 50ms tick.
    pub fn cleanup_stale_pending(&mut self) {
        if self.last_cleanup.elapsed() < std::time::Duration::from_secs(10) {
            return;
        }
        self.last_cleanup = Instant::now();

        let now = Instant::now();

        // pending_urls only contains actively-fetched URLs (not queued ones), so this
        // retain iterates at most concurrent_requests * 2 entries — always cheap.
        self.pending_urls
            .retain(|url, &mut added_time| {
                // Keep if still within the stale timeout OR still actively being processed.
                now.duration_since(added_time) < MAX_PENDING_TIME
                || self.active_urls.contains(url)
            });

        // Compact the VecDeque periodically once a significant number of items have
        // been drained from its front. VecDeque maintains a ring buffer that never
        // automatically shrinks, so without this call its allocated capacity grows
        // monotonically as the queue fills and drains across a long crawl.
        if self.queue.capacity() > self.queue.len().saturating_mul(4).max(256) {
            self.queue.shrink_to_fit();
        }

        // Periodically shrink the visited set's allocation after it plateaus.
        // HashSet doubles its capacity on resize but never shrinks; at 40K URLs the
        // backing array can be 2–4× larger than needed.
        // Only run this expensive operation every 5000 URLs to amortise the cost.
        if self.crawled_urls > 0 && self.crawled_urls % 5_000 == 0 {
            self.visited.shrink_to_fit();
            self.pending_urls.shrink_to_fit();
            self.url_patterns.shrink_to_fit();
        }

        // Evict oldest failed_urls entries if the set is over the cap.
        // total_failed_count is NOT affected — it always reflects the true count.
        if self.failed_urls.len() > MAX_FAILED_URLS {
            let mut v: Vec<FailedUrl> = self.failed_urls.drain().collect();
            // Keep the most-recently-recorded failures (largest timestamp).
            v.sort_unstable_by(|a, b| b.timestamp.partial_cmp(&a.timestamp)
                .unwrap_or(std::cmp::Ordering::Equal));
            v.truncate(MAX_FAILED_URLS / 2);
            self.failed_urls = v.into_iter().collect();
        }
    }

    /// Check if we should continue crawling
    pub fn should_continue(&self) -> bool {
        !self.queue.is_empty() || !self.pending_urls.is_empty() || self.active_tasks > 0
    }

    /// Check if crawl is truly complete (no pending work and all URLs accounted for)
    pub fn is_truly_complete(&self) -> bool {
        if !self.queue.is_empty() || self.active_tasks > 0 {
            return false;
        }
        // Even if pending_urls was cleaned up, verify that every discovered URL
        // has actually been processed (crawled or failed). This prevents premature
        // termination when cleanup_stale_pending evicts entries before their tasks finish.
        let accounted = self.crawled_urls + self.total_failed_count;
        self.pending_urls.is_empty() && accounted >= self.total_urls
    }

    /// Add multiple discovered URLs to the queue if they are new
    pub fn add_discovered_urls(
        &mut self,
        urls: HashSet<String>,
        base_url: &Url,
        _max_depth: usize,
        max_urls: usize,
        filters: &crate::domain_crawler::helpers::url_filters::UrlFilters,
    ) {
        for url_str in urls {
            // Normalize before any checks or queueing
            let normalized_url = normalize_url(&url_str);

            if let Ok(url) = Url::parse(&normalized_url) {
                // Basic validation: same domain check
                if url.domain() != base_url.domain() {
                    continue;
                }

                // Configuration > Include / Exclude. Applied here as well as at
                // link-discovery time so a sitemap can't smuggle in a URL the
                // user has excluded.
                if !filters.allows(&normalized_url) {
                    continue;
                }
                if !self.allows_by_robots(&normalized_url) {
                    continue;
                }

                // queued_url_set covers "waiting in queue"; pending_urls covers "actively fetching".
                // Both must be checked to avoid double-queueing.
                if !self.visited.contains(&normalized_url)
                    && !self.queued_url_set.contains(&normalized_url)
                    && !self.pending_urls.contains_key(&normalized_url)
                    && self.total_urls < max_urls
                {
                    self.queue.push_back((url.clone(), 0)); // Sitemaps seed at depth 0
                    self.queued_url_set.insert(normalized_url.clone());
                    self.total_urls += 1;
                    // pending_urls is NOT populated here; it is populated in the main loop
                    // when the URL is actually dequeued, keeping its size small.
                }
            }
        }
    }

    /// Enter a new task and return a guard that decrements active_tasks on drop
    pub fn enter_task(state: Arc<Mutex<Self>>, url: String) -> ActiveTaskGuard {
        ActiveTaskGuard { state, url }
    }
}

/// RAII guard to ensure active_tasks is always decremented
pub struct ActiveTaskGuard {
    state: Arc<Mutex<CrawlerState>>,
    url: String,
}

impl Drop for ActiveTaskGuard {
    fn drop(&mut self) {
        let state = self.state.clone();
        let url = self.url.clone();
        tokio::spawn(async move {
            let mut state_guard = state.lock().await;
            state_guard.active_tasks = state_guard.active_tasks.saturating_sub(1);
            state_guard.active_urls.remove(&url);
            state_guard.pending_urls.remove(&url);
        });
    }
}

/// Convert DomainCrawlResults to DatabaseResults
pub fn to_database_results(
    result: &DomainCrawlResults,
) -> Result<DatabaseResults, serde_json::Error> {
    Ok(DatabaseResults {
        url: result.url.clone(),
        data: serde_json::to_value(result)?,
    })
}

#[cfg(test)]
mod tests {
    use super::{CrawlerState, RobotsFetchStage};
    use crate::domain_crawler::helpers::robots::{parse_robots, RobotsPolicyCache};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::Mutex;
    use url::Url;

    #[tokio::test]
    async fn redirect_stops_when_the_target_is_already_crawled_or_in_flight() {
        let state = Arc::new(Mutex::new(CrawlerState::new(None)));
        let target = Url::parse("https://example.com/target").unwrap();
        let key = crate::domain_crawler::helpers::normalize_url::normalize_url(target.as_str());

        // Untouched target: the redirect may follow it.
        assert!(!CrawlerState::redirect_target_already_handled(&state, &target).await);

        // Its own queue entry is actively being fetched — following as well
        // would issue a duplicate GET and write a competing row.
        state
            .lock()
            .await
            .pending_urls
            .insert(key.clone(), std::time::Instant::now());
        assert!(CrawlerState::redirect_target_already_handled(&state, &target).await);

        // Already crawled: nothing left to fetch.
        {
            let mut guard = state.lock().await;
            guard.pending_urls.remove(&key);
            guard.visited.insert(key.clone());
        }
        assert!(CrawlerState::redirect_target_already_handled(&state, &target).await);
    }

    #[test]
    fn failure_is_discarded_when_a_redirect_source_already_accounted_the_url() {
        let mut state = CrawlerState::new(None);
        let url = "https://example.com/page";

        // The redirect source resolved to this URL and accounted for it first.
        state.visited.insert(url.to_string());
        state
            .pending_urls
            .insert(url.to_string(), std::time::Instant::now());

        assert!(
            !state.try_claim_failure(url),
            "a URL already accounted as crawled must not also be recorded as failed"
        );
        assert!(
            !state.pending_urls.contains_key(url),
            "the pending entry must still be cleared so the crawl can finish"
        );
    }

    #[test]
    fn failure_is_recorded_when_no_other_task_accounted_the_url() {
        let mut state = CrawlerState::new(None);
        let url = "https://example.com/only-here";
        state
            .pending_urls
            .insert(url.to_string(), std::time::Instant::now());

        assert!(state.try_claim_failure(url));
        assert!(!state.pending_urls.contains_key(url));
    }

    fn cache() -> Arc<RobotsPolicyCache> {
        Arc::new(
            RobotsPolicyCache::new(
                "StateBot",
                Duration::from_secs(2),
                Duration::from_secs(2),
                8,
            )
            .unwrap(),
        )
    }

    #[tokio::test]
    async fn initial_and_redirect_checks_use_their_exact_origins() {
        let cache = cache();
        let origin_a = Url::parse("https://a.example/initial/private").unwrap();
        let origin_b = Url::parse("https://b.example/redirect/private").unwrap();
        let (policy_a, _) =
            parse_robots("User-agent: *\nDisallow: /initial", "StateBot");
        let (policy_b, _) =
            parse_robots("User-agent: *\nDisallow: /redirect", "StateBot");
        assert!(cache.seed_policy(&origin_a, policy_a));
        assert!(cache.seed_policy(&origin_b, policy_b));
        let state = Arc::new(Mutex::new(
            CrawlerState::new(None).with_robots_cache(cache, true),
        ));

        let initial_error = CrawlerState::ensure_allowed_by_robots(
            &state,
            &origin_a,
            RobotsFetchStage::Initial,
        )
        .await
        .unwrap_err();
        assert!(initial_error.contains("before initial fetch"));
        assert!(CrawlerState::ensure_allowed_by_robots(
            &state,
            &Url::parse("https://a.example/redirect/private").unwrap(),
            RobotsFetchStage::Initial,
        )
        .await
        .is_ok());

        let redirect_error = CrawlerState::ensure_allowed_by_robots(
            &state,
            &origin_b,
            RobotsFetchStage::Redirect,
        )
        .await
        .unwrap_err();
        assert!(redirect_error.contains("before redirect fetch"));
        assert!(CrawlerState::ensure_allowed_by_robots(
            &state,
            &Url::parse("https://b.example/initial/private").unwrap(),
            RobotsFetchStage::Redirect,
        )
        .await
        .is_ok());

        let guard = state.lock().await;
        assert!(guard.robots_blocked_urls.contains(origin_a.as_str()));
        assert!(guard.robots_blocked_urls.contains(origin_b.as_str()));
    }

    #[tokio::test]
    async fn explicit_list_mode_ignores_robots_at_every_stage() {
        let cache = cache();
        let blocked = Url::parse("https://list.example/anything").unwrap();
        let (policy, _) = parse_robots("User-agent: *\nDisallow: /", "StateBot");
        assert!(cache.seed_policy(&blocked, policy));
        let state = Arc::new(Mutex::new(
            CrawlerState::new(None).with_robots_cache(cache, false),
        ));

        for stage in [
            RobotsFetchStage::Initial,
            RobotsFetchStage::Redirect,
            RobotsFetchStage::Discovered,
        ] {
            assert!(
                CrawlerState::ensure_allowed_by_robots(&state, &blocked, stage)
                    .await
                    .is_ok()
            );
        }
        assert!(state.lock().await.robots_blocked_urls.is_empty());
    }
}
