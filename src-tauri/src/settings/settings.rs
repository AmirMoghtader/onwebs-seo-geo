use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use sysinfo::{ProcessExt, System, SystemExt};
use tokio::fs;
use toml;
use uuid::Uuid;

use crate::domain_crawler::helpers::keyword_selector::default_stop_words;
use crate::domain_crawler::user_agents;
use crate::loganalyser::log_state::set_taxonomies;
use crate::settings::utils::agentic_bots::agentic_bots;
use crate::settings::utils::indexing_bots::generate_indexing_bots;
use crate::settings::utils::retrieval_agents::generate_retrieval_agents;
use crate::settings::utils::user_bots::generate_default_user_bots;
use crate::version::local_version;

/// Three, against `max_retries`' two: a truncated body is cheap to re-ask for
/// and usually succeeds on the next try.
pub fn default_body_read_attempts() -> u32 {
    3
}

/// Inherited from RustySEO, which hardcoded it. Kept as the default so a new
/// install has a working connector; replaced per-user from Settings.
pub fn default_open_page_rank_key() -> String {
    "44ss8gok0oo0c8kcckog0sgg8sswoswccgo08g80".to_string()
}

pub fn default_http_user_agent() -> String {
    format!(
        "Mozilla/5.0 (compatible; OnwebsSEO/{}; +https://github.com/AmirMoghtader/onwebs-seo-geo)",
        local_version()
    )
}

pub fn default_robots_user_agent() -> String {
    "OnwebsSEO".to_string()
}

// Settings cross process boundaries (TOML, JSON and the desktop UI), so they
// must be bounded before they are used as semaphore sizes, channel capacities,
// allocation hints or timeout durations. These are safety limits rather than
// crawl-performance claims.
const MAX_CRAWL_CONCURRENCY: usize = 256;
const MAX_LINK_CONCURRENCY: usize = 512;
const MAX_JS_CONCURRENCY: usize = 32;
const MAX_BATCH_SIZE: usize = 10_000;
const MAX_URLS_PER_DOMAIN: usize = 10_000_000;
const MAX_URLS_STORED: usize = 1_000_000;
const MAX_DELAY_MS: u64 = 3_600_000;
const MAX_REQUEST_TIMEOUT_SECS: u64 = 600;
const MAX_CRAWL_TIMEOUT_SECS: u64 = 604_800;
const MAX_RETRIES: u32 = 10;
const MAX_LINK_RETRIES: usize = 10;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct Settings {
    // CREATED ON
    pub date_created: String,
    // --- System ---
    /// Current version of the application
    pub version: String,
    /// Unique ID for this instance
    pub rustyid: Uuid,

    // --- General Crawler Settings ---
    /// List of user agents to rotate
    pub user_agents: Vec<String>,

    /// User-Agent sent in HTTP requests. This is intentionally independent
    /// from `robots_user_agent`, matching Screaming Frog's configuration.
    pub http_user_agent: String,

    /// Product token used to select the applicable robots.txt group.
    pub robots_user_agent: String,

    /// Regex patterns, one per entry. A URL matching any of these is never
    /// crawled. Mirrors Screaming Frog's Configuration > Exclude.
    #[serde(default)]
    pub exclude_patterns: Vec<String>,

    /// Regex patterns. When non-empty a URL must match one of them to be
    /// crawled, which scopes the crawl to a section of the site.
    /// Mirrors Screaming Frog's Configuration > Include.
    #[serde(default)]
    pub include_patterns: Vec<String>,

    /// List mode: visit exactly `list_urls` and follow no links out of them.
    /// Mirrors Screaming Frog's Mode > List — for auditing a specific set of
    /// pages rather than discovering a whole site.
    #[serde(default)]
    pub list_mode: bool,
    /// The URLs List mode should crawl. Ignored unless `list_mode` is on.
    #[serde(default)]
    pub list_urls: Vec<String>,

    /// Number of concurrent requests for domain crawling
    pub concurrent_requests: usize,
    /// Number of URLs to process between sleeps/checks
    pub batch_size: usize,
    /// Maximum depth to crawl
    pub max_depth: usize,
    /// Maximum URLs to crawl per domain
    pub max_urls_per_domain: usize,
    /// Max URLS to keep in the front End (JS Heap)
    /// They will always be fetched via sqlite DB
    /// NOTE: check the GlobalCrawlDataStore
    pub max_urls_stored: usize,

    // --- Timing & Throttling (Adaptive) ---
    /// Enable adaptive crawling speed based on server response
    pub adaptive_crawling: bool,
    /// Base delay between requests (ms)
    pub base_delay: u64,
    /// Maximum delay between requests (ms)
    pub max_delay: u64,
    /// Minimum delay allowed in adaptive mode (ms)
    pub min_crawl_delay: u64,
    /// Total timeout for a crawl job (seconds)
    pub crawl_timeout: u64,
    /// Interval to check for stalled crawlers (seconds)
    pub stall_check_interval: u64,
    /// Maximum time a URL can be pending before considered stalled (seconds)
    pub max_pending_time: u64,
    /// Threashold for table download switch from memory to sqlite excel export

    // --- Request / Network ---
    /// Timeout for individual HTTP requests (seconds)
    pub client_timeout: u64,
    /// Timeout for connection establishment (seconds)
    pub client_connect_timeout: u64,
    /// Number of redirects to follow
    pub redirect_policy: usize,
    /// Extra attempts at reading a response body after the request already
    /// succeeded, each after a doubling backoff.
    ///
    /// Separate from `max_retries`, and larger, because it answers a different
    /// failure: not "the host would not talk to us" but "the host stopped
    /// mid-sentence". Every one of the 27 failures in an 810-page websima.com
    /// crawl was that, and the same pages read fine when asked again.
    #[serde(default = "default_body_read_attempts")]
    pub body_read_attempts: u32,
    /// Open PageRank API key for the domain-authority lookup.
    ///
    /// Defaults to the key RustySEO ships with, so the feature works out of
    /// the box on a fresh install. That key is shared by every user of every
    /// fork and its monthly allowance is finite — the onboarding tour asks for
    /// your own, and anything set here stays in the local config file.
    #[serde(default = "default_open_page_rank_key")]
    pub open_page_rank_api_key: String,
    /// Maximum retries for failed requests
    pub max_retries: u32,

    // --- JavaScript & Rendering ---
    /// Whether to expect HTML content
    pub html: bool,
    /// Enable Headless Chrome rendering
    pub javascript_rendering: bool,
    /// Concurrency for Headless Chrome
    pub javascript_concurrency: usize,

    // --- Link Processor (Internal/External Check) ---
    /// Max concurrent checks for link status
    pub links_max_concurrent_requests: usize,
    /// Initial capacity for link checking tasks
    pub links_initial_task_capacity: usize,
    /// Max retries for link checks
    pub links_max_retries: usize,
    /// Delay between link check retries (ms)
    pub links_retry_delay: u64,
    /// Timeout for link check requests (seconds)
    pub links_request_timeout: u64,
    /// Jitter factor for randomized delays (0.0 - 1.0)
    pub links_jitter_factor: f32,
    /// Idle timeout for connection pool (seconds)
    pub links_pool_idle_timeout: u64,
    /// Max idle connections per host
    pub links_max_idle_per_host: usize,

    // --- Crawl Analysis ---
    /// Automatically compute Link Score (internal PageRank-style authority, 1-100)
    /// at the end of every crawl
    pub link_score_enabled: bool,
    /// Compute a per-page content fingerprint (SimHash of body text + heading hash)
    /// during crawl so the Duplicate Content dashboard tab can cluster similar/identical
    /// pages afterwards. Off by default — it's an opt-in, since it does extra text
    /// processing per page.
    pub duplicate_content_check_enabled: bool,

    // --- Extraction & Content ---
    /// Enable N-gram extraction
    pub extract_ngrams: bool,
    /// Set of stop words for keyword extraction
    pub stop_words: HashSet<String>,
    /// Classification taxonomies
    pub taxonomies: Vec<String>,

    // --- Database & Batching ---
    /// Batch size for database inserts
    pub db_batch_size: usize,
    /// Chunk size for domain crawler results
    pub db_chunk_size_domain_crawler: usize,

    // --- Logs & File System ---
    pub log_batchsize: usize,
    pub log_chunk_size: usize,
    pub log_sleep_stream_duration: u64,
    pub log_capacity: usize,
    pub log_project_chunk_size: usize,
    pub log_file_upload_size: usize,
    pub log_bots: Vec<(String, String)>,
    // Normal indexing bots/crawlers
    pub indexing_bots: Vec<String>,
    // Bots that consume content to feed LLMs
    pub retrieval_agents: Vec<String>,
    // Agentic crawlers that perform tasks
    pub agentic_bots: Vec<String>,

    // --- Integrations ---
    /// Enable PageSpeed Insights bulk fetching
    pub page_speed_bulk: bool,
    /// API Key for PageSpeed Insights
    pub page_speed_bulk_api_key: Option<Option<String>>,
    /// Row limit for GSC data
    pub gsc_row_limit: i32,

    // --- AXUM API SERVER ---
    pub axum_api_server: bool,
    pub axum_api_host: String,
    pub axum_api_port: u16,
}

impl Settings {
    pub fn new() -> Self {
        Self {
            // -- CREATED ON
            date_created: chrono::Utc::now().to_rfc3339(),

            // --- System ---
            version: local_version(),
            rustyid: Uuid::new_v4(),

            // --- General Crawler Settings ---
            user_agents: user_agents::agents(),
            http_user_agent: default_http_user_agent(),
            robots_user_agent: default_robots_user_agent(),
            exclude_patterns: Vec::new(),
            list_mode: false,
            list_urls: Vec::new(),
            include_patterns: Vec::new(),
            // Six, not sixteen. A slow host (websima.com answers in up to 10.8s
            // under Screaming Frog's gentle 5-thread load) collapses under a
            // wide fan-out: responses cross the 20s client timeout and the URL
            // is recorded as failed. Screaming Frog finishes such a site at
            // ~1.7 URL/s; a crawl that completes slowly beats one that dies
            // fast. Users on fast hosts can raise this in Settings.
            concurrent_requests: 6,
            batch_size: 40,
            max_depth: 50,
            max_urls_per_domain: 100000,
            max_urls_stored: 5000,

            // --- Timing & Throttling ---
            adaptive_crawling: true,
            base_delay: 0,
            max_delay: 30000,     // Increased from 10000 — gives adaptive system more room
            min_crawl_delay: 0,
            crawl_timeout: 28800,
            stall_check_interval: 30, // SECONDS
            max_pending_time: 900,    // SECONDS

            // --- Request / Network ---
            client_timeout: 20,
            client_connect_timeout: 15,
            redirect_policy: 5,
            max_retries: 2,
            open_page_rank_api_key: default_open_page_rank_key(),
            body_read_attempts: default_body_read_attempts(),

            // --- JavaScript & Rendering ---
            html: false,
            javascript_rendering: false,
            javascript_concurrency: 3,

            // --- Link Processor ---
            links_max_concurrent_requests: 50, // Increased to avoid link checking bottleneck
            links_initial_task_capacity: 100,
            links_max_retries: 3,
            links_retry_delay: 1000, // Increased from 500
            links_request_timeout: 15,
            links_jitter_factor: 0.6, // Increased from 0.5
            links_pool_idle_timeout: 60,
            links_max_idle_per_host: 5, // Reduced from 10

            // --- Crawl Analysis ---
            link_score_enabled: true,
            duplicate_content_check_enabled: false,

            // --- Extraction & Content ---
            extract_ngrams: false,
            stop_words: default_stop_words(),
            taxonomies: set_taxonomies(),

            // --- Database & Batching ---
            db_batch_size: 200,
            db_chunk_size_domain_crawler: 500,

            // --- Logs & File System ---
            log_batchsize: 2,
            log_chunk_size: 10000,
            log_sleep_stream_duration: 1,
            log_capacity: 1,
            log_project_chunk_size: 1,
            log_file_upload_size: 75, // THE DEFAULT VALUE TO FILE UPLOADING
            log_bots: generate_default_user_bots(),
            indexing_bots: generate_indexing_bots(),
            retrieval_agents: generate_retrieval_agents(),
            agentic_bots: agentic_bots(),

            // --- Integrations ---
            page_speed_bulk: false,
            page_speed_bulk_api_key: None,
            gsc_row_limit: 25000,

            // AXUM API SERVER
            axum_api_server: false,
            axum_api_host: "127.0.0.1".to_string(),
            axum_api_port: 3000,
        }
    }

    pub fn generate_commented_config(&self) -> String {
        let mut s = String::new();

        s.push_str("# --- Created On ---\n");
        s.push_str(&format!("date_created = {:?}\n", self.date_created));

        s.push_str("# --- System ---\n");
        s.push_str("# Current version of the application\n");
        s.push_str(&format!("version = {:?}\n", self.version));
        s.push_str("# Unique ID for this instance\n");
        s.push_str(&format!("rustyid = {:?}\n", self.rustyid.to_string()));

        s.push_str("\n# --- General Crawler Settings ---\n");
        s.push_str("# List of user agents to rotate\n");
        let ua = serde_json::to_string(&self.user_agents).unwrap_or_else(|_| "[]".to_string());
        s.push_str(&format!("user_agents = {}\n", ua));
        s.push_str(&format!("http_user_agent = {:?}\n", self.http_user_agent));
        s.push_str(&format!("robots_user_agent = {:?}\n", self.robots_user_agent));
        let ex = serde_json::to_string(&self.exclude_patterns).unwrap_or_else(|_| "[]".to_string());
        s.push_str(&format!("exclude_patterns = {}\n", ex));
        s.push_str(&format!("list_mode = {}\n", self.list_mode));
        let lst = serde_json::to_string(&self.list_urls).unwrap_or_else(|_| "[]".to_string());
        s.push_str(&format!("list_urls = {}\n", lst));
        let inc = serde_json::to_string(&self.include_patterns).unwrap_or_else(|_| "[]".to_string());
        s.push_str(&format!("include_patterns = {}\n", inc));

        s.push_str("# Number of concurrent requests for domain crawling\n");
        s.push_str(&format!(
            "concurrent_requests = {}\n",
            self.concurrent_requests
        ));

        s.push_str("# Number of URLs to process between sleeps/checks\n");
        s.push_str(&format!("batch_size = {}\n", self.batch_size));

        s.push_str("# Maximum depth to crawl\n");
        s.push_str(&format!("max_depth = {}\n", self.max_depth));

        s.push_str("# Maximum URLs to crawl per domain\n");
        s.push_str(&format!(
            "max_urls_per_domain = {}\n",
            self.max_urls_per_domain
        ));

        // MAX URLS STORED IN JS HEAP
        s.push_str("# Max URLS TO SHOWCASE IN THE FRONTEND, JAvascript HEAP\n");
        s.push_str(&format!("max_urls_stored = {}\n", self.max_urls_stored));

        s.push_str("\n# --- Timing & Throttling (Adaptive) ---\n");
        s.push_str("# Enable adaptive crawling speed based on server response\n");
        s.push_str(&format!("adaptive_crawling = {}\n", self.adaptive_crawling));

        s.push_str("# Base delay between requests (ms)\n");
        s.push_str(&format!("base_delay = {}\n", self.base_delay));

        s.push_str("# Maximum delay between requests (ms)\n");
        s.push_str(&format!("max_delay = {}\n", self.max_delay));

        s.push_str("# Minimum delay allowed in adaptive mode (ms)\n");
        s.push_str(&format!("min_crawl_delay = {}\n", self.min_crawl_delay));

        s.push_str("# Total timeout for a crawl job (seconds)\n");
        s.push_str(&format!("crawl_timeout = {}\n", self.crawl_timeout));

        s.push_str("# Interval to check for stalled crawlers (seconds)\n");
        s.push_str(&format!(
            "stall_check_interval = {}\n",
            self.stall_check_interval
        ));

        s.push_str("# Maximum time a URL can be pending before considered stalled (seconds)\n");
        s.push_str(&format!("max_pending_time = {}\n", self.max_pending_time));

        s.push_str("\n# --- Request / Network ---\n");
        s.push_str("# Timeout for individual HTTP requests (seconds)\n");
        s.push_str(&format!("client_timeout = {}\n", self.client_timeout));

        s.push_str("# Timeout for connection establishment (seconds)\n");
        s.push_str(&format!(
            "client_connect_timeout = {}\n",
            self.client_connect_timeout
        ));

        s.push_str("# Number of redirects to follow\n");
        s.push_str(&format!("redirect_policy = {}\n", self.redirect_policy));

        s.push_str("# Maximum retries for failed requests\n");
        s.push_str(&format!("max_retries = {}\n", self.max_retries));

        s.push_str("\n# --- JavaScript & Rendering ---\n");
        s.push_str("# Whether to expect HTML content\n");
        s.push_str(&format!("body_read_attempts = {}\n", self.body_read_attempts));
        s.push_str(&format!("open_page_rank_api_key = \"{}\"\n", self.open_page_rank_api_key));
        s.push_str(&format!("html = {}\n", self.html));

        s.push_str("# Enable Headless Chrome rendering\n");
        s.push_str(&format!(
            "javascript_rendering = {}\n",
            self.javascript_rendering
        ));

        s.push_str("# Concurrency for Headless Chrome\n");
        s.push_str(&format!(
            "javascript_concurrency = {}\n",
            self.javascript_concurrency
        ));

        s.push_str("\n# --- Link Processor (Internal/External Check) ---\n");
        s.push_str("# Max concurrent checks for link status\n");
        s.push_str(&format!(
            "links_max_concurrent_requests = {}\n",
            self.links_max_concurrent_requests
        ));

        s.push_str("# Initial capacity for link checking tasks\n");
        s.push_str(&format!(
            "links_initial_task_capacity = {}\n",
            self.links_initial_task_capacity
        ));

        s.push_str("# Max retries for link checks\n");
        s.push_str(&format!("links_max_retries = {}\n", self.links_max_retries));

        s.push_str("# Delay between link check retries (ms)\n");
        s.push_str(&format!("links_retry_delay = {}\n", self.links_retry_delay));

        s.push_str("# Timeout for link check requests (seconds)\n");
        s.push_str(&format!(
            "links_request_timeout = {}\n",
            self.links_request_timeout
        ));

        s.push_str("# Jitter factor for randomized delays (0.0 - 1.0)\n");
        s.push_str(&format!(
            "links_jitter_factor = {}\n",
            self.links_jitter_factor
        ));

        s.push_str("# Idle timeout for connection pool (seconds)\n");
        s.push_str(&format!(
            "links_pool_idle_timeout = {}\n",
            self.links_pool_idle_timeout
        ));

        s.push_str("# Max idle connections per host\n");
        s.push_str(&format!(
            "links_max_idle_per_host = {}\n",
            self.links_max_idle_per_host
        ));

        s.push_str("\n# --- Crawl Analysis ---\n");
        s.push_str("# Automatically compute Link Score at the end of every crawl\n");
        s.push_str(&format!(
            "link_score_enabled = {}\n",
            self.link_score_enabled
        ));

        s.push_str("# Compute per-page content fingerprints during crawl to power the\n");
        s.push_str("# Duplicate Content dashboard tab. Off by default (adds per-page work).\n");
        s.push_str(&format!(
            "duplicate_content_check_enabled = {}\n",
            self.duplicate_content_check_enabled
        ));

        s.push_str("\n# --- Extraction & Content ---\n");
        s.push_str("# Enable N-gram extraction\n");
        s.push_str(&format!("extract_ngrams = {}\n", self.extract_ngrams));

        s.push_str("# Set of stop words for keyword extraction\n");
        let stop_words =
            serde_json::to_string(&self.stop_words).unwrap_or_else(|_| "[]".to_string());
        s.push_str(&format!("stop_words = {}\n", stop_words));

        s.push_str("# Classification taxonomies\n");
        let taxonomies =
            serde_json::to_string(&self.taxonomies).unwrap_or_else(|_| "[]".to_string());
        s.push_str(&format!("taxonomies = {}\n", taxonomies));

        s.push_str("\n# --- Database & Batching ---\n");
        s.push_str("# Batch size for database inserts\n");
        s.push_str(&format!("db_batch_size = {}\n", self.db_batch_size));

        s.push_str("# Chunk size for domain crawler results\n");
        s.push_str(&format!(
            "db_chunk_size_domain_crawler = {}\n",
            self.db_chunk_size_domain_crawler
        ));

        // LOGS STUFF GOES HERE
        s.push_str("\n# --- Logs & File System ---\n");
        s.push_str("# log_batchsize\n");
        s.push_str(&format!("log_batchsize = {}\n", self.log_batchsize));

        s.push_str("# log_chunk_size\n");
        s.push_str(&format!("log_chunk_size = {}\n", self.log_chunk_size));

        s.push_str("# log_sleep_stream_duration\n");
        s.push_str(&format!(
            "log_sleep_stream_duration = {}\n",
            self.log_sleep_stream_duration
        ));

        s.push_str("# log_capacity\n");
        s.push_str(&format!("log_capacity = {}\n", self.log_capacity));

        s.push_str("# log_project_chunk_size\n");
        s.push_str(&format!(
            "log_project_chunk_size = {}\n",
            self.log_project_chunk_size
        ));

        s.push_str("# log_file_upload_size\n");
        s.push_str(&format!(
            "log_file_upload_size = {}\n",
            self.log_file_upload_size
        ));

        s.push_str("# Log Bots\n");
        let bots = serde_json::to_string(&self.log_bots).unwrap_or_else(|_| "[]".to_string());
        s.push_str(&format!("log_bots = {}\n", bots));

        s.push_str("# Indexing Bots\n");
        let indexing_bots =
            serde_json::to_string(&self.indexing_bots).unwrap_or_else(|_| "[]".to_string());
        s.push_str(&format!("indexing_bots = {}\n", indexing_bots));

        s.push_str("# Retrieval Agents\n");
        let retrieval_agents =
            serde_json::to_string(&self.retrieval_agents).unwrap_or_else(|_| "[]".to_string());
        s.push_str(&format!("retrieval_agents = {}\n", retrieval_agents));

        s.push_str("# Agentic Bots\n");
        let agentic_bots =
            serde_json::to_string(&self.agentic_bots).unwrap_or_else(|_| "[]".to_string());
        s.push_str(&format!("agentic_bots = {}\n", agentic_bots));

        s.push_str("\n# --- Integrations ---\n");
        s.push_str("# Enable PageSpeed Insights bulk fetching\n");
        s.push_str(&format!("page_speed_bulk = {}\n", self.page_speed_bulk));

        if let Some(Some(key)) = &self.page_speed_bulk_api_key {
            s.push_str("# API Key for PageSpeed Insights\n");
            s.push_str(&format!("page_speed_bulk_api_key = {:?}\n", key));
        }

        s.push_str("# Row limit for GSC data\n");
        s.push_str(&format!("gsc_row_limit = {}\n", self.gsc_row_limit));

        // API SERVER
        s.push_str("\n# --- API Server ---\n");
        s.push_str("# Enable API server\n");
        s.push_str(&format!("axum_api_server = {}\n", self.axum_api_server));
        s.push_str(&format!("axum_api_port = {}\n", self.axum_api_port));
        s.push_str(&format!("axum_api_host = {:?}\n", self.axum_api_host));

        s
    }

    pub fn config_path() -> Result<PathBuf, String> {
        crate::app_dirs::config_dir().map(|dir| dir.join("configs.toml"))
    }

    /// Bring older config files forward without discarding user choices.
    /// Returns true when a value was repaired or migrated and should be saved.
    fn normalize_migrated(&mut self) -> bool {
        let mut changed = false;
        let default_http = default_http_user_agent();

        // The previous UI stored the selected request UA as a one-item legacy
        // vector. Adopt it once when the new explicit field is not meaningful.
        if (self.http_user_agent.trim().is_empty()
            || (self.http_user_agent == default_http && self.user_agents.len() == 1))
            && self.user_agents.first().is_some_and(|ua| !ua.trim().is_empty())
        {
            self.http_user_agent = self.user_agents[0].trim().to_string();
            changed = true;
        }
        if self.http_user_agent.trim().is_empty() {
            self.http_user_agent = default_http;
            changed = true;
        }
        if self.robots_user_agent.trim().is_empty() {
            self.robots_user_agent = default_robots_user_agent();
            changed = true;
        }
        if self.user_agents.is_empty() {
            self.user_agents = user_agents::agents();
            changed = true;
        }

        macro_rules! repair {
            ($field:ident, $value:expr) => {{
                let repaired = $value;
                if self.$field != repaired {
                    self.$field = repaired;
                    changed = true;
                }
            }};
        }

        // Empty capacities can panic (Semaphore::new(0) never progresses) or
        // create tight loops. Very large values can result in accidental
        // multi-gigabyte allocations after a negative UI value is converted.
        repair!(concurrent_requests, self.concurrent_requests.clamp(1, MAX_CRAWL_CONCURRENCY));
        repair!(batch_size, self.batch_size.clamp(1, MAX_BATCH_SIZE));
        repair!(javascript_concurrency, self.javascript_concurrency.clamp(1, MAX_JS_CONCURRENCY));
        repair!(links_max_concurrent_requests, self.links_max_concurrent_requests.clamp(1, MAX_LINK_CONCURRENCY));
        repair!(links_initial_task_capacity, self.links_initial_task_capacity.clamp(1, 1_000_000));
        repair!(db_batch_size, self.db_batch_size.clamp(1, MAX_BATCH_SIZE));
        repair!(db_chunk_size_domain_crawler, self.db_chunk_size_domain_crawler.clamp(1, 100_000));

        repair!(max_depth, self.max_depth.min(1_000));
        repair!(max_urls_per_domain, self.max_urls_per_domain.clamp(1, MAX_URLS_PER_DOMAIN));
        repair!(max_urls_stored, self.max_urls_stored.clamp(100, MAX_URLS_STORED));
        repair!(redirect_policy, self.redirect_policy.min(50));
        repair!(max_retries, self.max_retries.min(MAX_RETRIES));
        repair!(links_max_retries, self.links_max_retries.min(MAX_LINK_RETRIES));

        // Delay relationships are normalized together: the advertised maximum
        // must never be lower than either the initial or adaptive minimum.
        repair!(base_delay, self.base_delay.min(MAX_DELAY_MS));
        repair!(min_crawl_delay, self.min_crawl_delay.min(MAX_DELAY_MS));
        repair!(max_delay, self.max_delay.min(MAX_DELAY_MS));
        repair!(max_delay, self.max_delay.max(self.base_delay).max(self.min_crawl_delay));
        repair!(links_retry_delay, self.links_retry_delay.min(MAX_DELAY_MS));

        // Timeout relationships are ordered from the individual request up to
        // the whole crawl, preventing impossible stall/timeout combinations.
        repair!(client_timeout, self.client_timeout.clamp(1, MAX_REQUEST_TIMEOUT_SECS));
        repair!(client_connect_timeout, self.client_connect_timeout.clamp(1, self.client_timeout));
        repair!(crawl_timeout, self.crawl_timeout.clamp(1, MAX_CRAWL_TIMEOUT_SECS));
        repair!(crawl_timeout, self.crawl_timeout.max(self.client_timeout));
        repair!(max_pending_time, self.max_pending_time.clamp(self.client_timeout, self.crawl_timeout));
        repair!(stall_check_interval, self.stall_check_interval.clamp(1, self.max_pending_time));
        repair!(links_request_timeout, self.links_request_timeout.clamp(1, MAX_REQUEST_TIMEOUT_SECS));
        repair!(links_request_timeout, self.links_request_timeout.max(self.client_connect_timeout));
        repair!(links_pool_idle_timeout, self.links_pool_idle_timeout.clamp(1, 3_600));
        repair!(links_max_idle_per_host, self.links_max_idle_per_host.clamp(1, 256).min(self.links_max_concurrent_requests));

        let jitter = if self.links_jitter_factor.is_finite() {
            self.links_jitter_factor.clamp(0.0, 1.0)
        } else {
            Settings::new().links_jitter_factor
        };
        repair!(links_jitter_factor, jitter);

        repair!(log_batchsize, self.log_batchsize.clamp(1, 100_000));
        repair!(log_chunk_size, self.log_chunk_size.clamp(1, 10_000_000));
        repair!(log_sleep_stream_duration, self.log_sleep_stream_duration.clamp(1, 3_600));
        repair!(log_capacity, self.log_capacity.clamp(1, 100_000));
        repair!(log_project_chunk_size, self.log_project_chunk_size.clamp(1, 100_000));
        repair!(log_file_upload_size, self.log_file_upload_size.clamp(1, 100_000));
        repair!(gsc_row_limit, self.gsc_row_limit.clamp(1, 1_000_000));
        repair!(axum_api_port, if self.axum_api_port == 0 { 3000 } else { self.axum_api_port });
        let trimmed_api_host = self.axum_api_host.trim();
        let normalized_api_host = if trimmed_api_host.is_empty() {
            "127.0.0.1".to_string()
        } else {
            trimmed_api_host.to_string()
        };
        if self.axum_api_host != normalized_api_host {
            self.axum_api_host = normalized_api_host;
            changed = true;
        }
        if self.version != local_version() {
            self.version = local_version();
            changed = true;
        }

        changed
    }

    // Delete the file
    pub fn delete_file() -> Result<(), String> {
        let config_path = Self::config_path()?;
        std::fs::remove_file(config_path).map_err(|e| e.to_string())
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self::new()
    }
}

/// Loads settings from file (returns error if file doesn't exist)
pub async fn load_settings() -> Result<Settings, String> {
    let config_path = Settings::config_path()?;
    let contents = fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let mut settings: Settings =
        toml::from_str(&contents).map_err(|e| format!("Failed to parse config: {}", e))?;
    if settings.normalize_migrated() {
        persist_settings(&settings).await?;
    }
    Ok(settings)
}

pub async fn check_and_replace() {
    // Kept for existing callers. `load_settings` now performs a field-level,
    // non-destructive migration instead of deleting the whole config whenever
    // the application version changes.
    if let Err(e) = load_settings().await {
        eprintln!("Warning: settings migration check failed: {}", e);
    }
}

async fn persist_settings(settings: &Settings) -> Result<(), String> {
    let config_path = Settings::config_path()?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
    }

    let serialized = toml::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    let temp_path = config_path.with_extension(format!("toml.tmp-{}", Uuid::new_v4()));
    fs::write(&temp_path, serialized)
        .await
        .map_err(|e| format!("Failed to write temporary config: {}", e))?;

    // rename is atomic on Unix. Windows cannot replace an existing file with
    // rename, so retain a backup before swapping there.
    #[cfg(target_os = "windows")]
    if config_path.exists() {
        let backup_path = config_path.with_extension("toml.bak");
        fs::copy(&config_path, &backup_path)
            .await
            .map_err(|e| format!("Failed to back up config: {}", e))?;
        fs::remove_file(&config_path)
            .await
            .map_err(|e| format!("Failed to replace config: {}", e))?;
    }

    fs::rename(&temp_path, &config_path)
        .await
        .map_err(|e| format!("Failed to activate config: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&config_path, std::fs::Permissions::from_mode(0o600))
            .await
            .map_err(|e| format!("Failed to secure config: {}", e))?;
    }
    Ok(())
}

/// Creates a new config file if it doesn't exist
pub async fn create_config_file() -> Result<Settings, String> {
    let config_path = Settings::config_path()?;
    println!("Config path: {:?}", config_path);

    if let Some(parent) = config_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create config dir: {}", e))?;
        }
    }

    let settings = Settings::new();

    if !config_path.exists() {
        persist_settings(&settings).await?;
        println!("✅ Config file created at {:?}", config_path);
    } else {
        println!("⚠️ Config file already exists at {:?}", config_path);
    }

    Ok(settings)
}

/// Initializes settings (loads or creates if missing)
pub async fn init_settings() -> Result<Settings, String> {
    println!("Attempting to load settings...");
    match load_settings().await {
        Ok(settings) => {
            println!("Settings loaded successfully.");
            Ok(settings)
        }
        Err(e) => {
            println!("Failed to load settings: {}. Creating config file...", e);
            // Preserve invalid data for recovery/debugging instead of silently
            // deleting API choices and crawl preferences.
            if let Ok(config_path) = Settings::config_path() {
                if config_path.exists() {
                    let backup = config_path.with_extension(format!(
                        "toml.invalid-{}.bak",
                        chrono::Utc::now().format("%Y%m%dT%H%M%SZ")
                    ));
                    fs::rename(&config_path, &backup)
                        .await
                        .map_err(|rename_error| {
                            format!(
                                "Failed to preserve invalid config ({e}): {rename_error}"
                            )
                        })?;
                    eprintln!("Invalid config preserved at {:?}", backup);
                }
            }
            create_config_file().await
        }
    }
}

pub fn print_settings(settings: &Settings) {
    // Use the settings
    println!("Created at: {}", settings.date_created);
    println!("Version: {}", settings.version);
    println!("Crawl Timeout: {:?}", settings.crawl_timeout);
    println!("Client Timeout: {:?}", settings.client_timeout);
    println!(
        "Client Connect Timeout: {:?}",
        settings.client_connect_timeout
    );
    println!("Redirect Policy: {:?}", settings.redirect_policy);
    println!("Max Retries: {}", settings.max_retries);
    println!("Base Delay: {}", settings.base_delay);
    println!("Max Delay: {}", settings.max_delay);
    println!("Concurrent Requests: {}", settings.concurrent_requests);
    println!("Batch Size: {}", settings.batch_size);
    println!("DB Batch Size: {}", settings.db_batch_size);
    println!(
        "Max URLS Stored In front end JS (HEAP): {} ",
        settings.max_urls_stored
    );
    println!(
        "Links Concurrent Requests: {}",
        settings.links_max_concurrent_requests
    );
    println!("HTTP User-Agent configured: {}", !settings.http_user_agent.is_empty());
    println!("Robots User-Agent: {}", settings.robots_user_agent);
    println!("HTML: {}", settings.html);
    println!(
        "Links Initial Task Capacity: {}",
        settings.links_initial_task_capacity
    );
    println!("Links Max Retries: {}", settings.links_max_retries);
    println!("Links Retry Delay: {}", settings.links_retry_delay);
    println!("Links Request Timeout: {}", settings.links_request_timeout);
    println!("Taxonomies: {:?}", settings.taxonomies);
    println!("Rusty ID: {}", settings.rustyid);
    println!("Page Speed Bulkd: {}", settings.page_speed_bulk);
    println!(
        "Page Speed Bulk API Key configured: {}",
        matches!(&settings.page_speed_bulk_api_key, Some(Some(key)) if !key.is_empty())
    );

    println!("Log Batchsize: {}", settings.log_batchsize);
    println!("Log Chunksize: {}", settings.log_chunk_size);
    println!(
        "Log Sleep Stream Duration: {}",
        settings.log_sleep_stream_duration
    );

    println!("Log Capacity: {}", settings.log_capacity);
    println!(
        "Log Chunk Size Project: {}",
        settings.log_project_chunk_size
    );

    println!("Log File Upload Size: {}", settings.log_file_upload_size);

    println!("Ngrams: {}", settings.extract_ngrams);

    println!("Log Bots: {:#?}", settings.log_bots);
    println!("Retrival Agents: {:#?}", settings.retrieval_agents);
    println!("Agentic Bots: {:#?}", settings.agentic_bots);

    println!("GSC Row Limit: {}", settings.gsc_row_limit);
    println!("Adaptive Crawling: {}", settings.adaptive_crawling);
    println!("Min Crawl Delay: {}", settings.min_crawl_delay);

    println!("");
    println!("API Server: {}", settings.axum_api_server);
    println!("API Port: {}", settings.axum_api_port);
    println!("API Host: {}", settings.axum_api_host);

    println!("")
}

fn non_negative_u64(value: i64) -> u64 {
    u64::try_from(value).unwrap_or(0)
}

fn non_negative_usize(value: i64) -> usize {
    usize::try_from(value).unwrap_or_else(|_| if value < 0 { 0 } else { usize::MAX })
}

fn non_negative_u32(value: i64) -> u32 {
    u32::try_from(value).unwrap_or_else(|_| if value < 0 { 0 } else { u32::MAX })
}

fn non_negative_i32(value: i64) -> i32 {
    if value < 0 {
        0
    } else {
        i32::try_from(value).unwrap_or(i32::MAX)
    }
}

fn valid_port_candidate(value: i64) -> u16 {
    u16::try_from(value).unwrap_or_else(|_| if value < 0 { 0 } else { u16::MAX })
}

/// Apply numeric UI/TOML values without ever casting a negative signed value
/// into an enormous unsigned integer. Bounds and cross-field relationships are
/// handled by `normalize_migrated` immediately afterwards.
fn apply_numeric_updates(settings: &mut Settings, updates: &HashMap<String, toml::Value>) {
    macro_rules! u64_value {
        ($key:literal, $field:ident) => {
            if let Some(value) = updates.get($key).and_then(toml::Value::as_integer) {
                settings.$field = non_negative_u64(value);
            }
        };
    }
    macro_rules! usize_value {
        ($key:literal, $field:ident) => {
            if let Some(value) = updates.get($key).and_then(toml::Value::as_integer) {
                settings.$field = non_negative_usize(value);
            }
        };
    }

    u64_value!("crawl_timeout", crawl_timeout);
    u64_value!("client_timeout", client_timeout);
    u64_value!("client_connect_timeout", client_connect_timeout);
    usize_value!("redirect_policy", redirect_policy);
    if let Some(value) = updates.get("max_retries").and_then(toml::Value::as_integer) {
        settings.max_retries = non_negative_u32(value);
    }
    u64_value!("base_delay", base_delay);
    u64_value!("max_delay", max_delay);
    u64_value!("min_crawl_delay", min_crawl_delay);
    usize_value!("max_urls_stored", max_urls_stored);
    usize_value!("concurrent_requests", concurrent_requests);
    usize_value!("batch_size", batch_size);
    usize_value!("db_batch_size", db_batch_size);
    usize_value!("links_max_concurrent_requests", links_max_concurrent_requests);
    usize_value!("links_initial_task_capacity", links_initial_task_capacity);
    usize_value!("links_max_retries", links_max_retries);
    u64_value!("links_retry_delay", links_retry_delay);
    u64_value!("links_request_timeout", links_request_timeout);
    usize_value!("log_batchsize", log_batchsize);
    usize_value!("log_chunk_size", log_chunk_size);
    u64_value!("log_sleep_stream_duration", log_sleep_stream_duration);
    usize_value!("log_capacity", log_capacity);
    // Accept both the persisted field name and the legacy UI key.
    if let Some(value) = updates
        .get("log_project_chunk_size")
        .or_else(|| updates.get("log_chunk_size_project"))
        .and_then(toml::Value::as_integer)
    {
        settings.log_project_chunk_size = non_negative_usize(value);
    }
    usize_value!("log_file_upload_size", log_file_upload_size);
    if let Some(value) = updates.get("gsc_row_limit").and_then(toml::Value::as_integer) {
        settings.gsc_row_limit = non_negative_i32(value);
    }
    usize_value!("javascript_concurrency", javascript_concurrency);
    u64_value!("stall_check_interval", stall_check_interval);
    u64_value!("max_pending_time", max_pending_time);
    usize_value!("max_depth", max_depth);
    usize_value!("max_urls_per_domain", max_urls_per_domain);
    u64_value!("links_pool_idle_timeout", links_pool_idle_timeout);
    usize_value!("links_max_idle_per_host", links_max_idle_per_host);
    usize_value!("db_chunk_size_domain_crawler", db_chunk_size_domain_crawler);

    if let Some(value) = updates.get("links_jitter_factor") {
        if let Some(value) = value
            .as_float()
            .or_else(|| value.as_integer().map(|integer| integer as f64))
        {
            settings.links_jitter_factor = value as f32;
        }
    }

    if let Some(value) = updates
        .get("axum_api_port")
        .or_else(|| updates.get("axum_api_server_port"))
        .and_then(toml::Value::as_integer)
    {
        settings.axum_api_port = valid_port_candidate(value);
    }
}

pub async fn override_settings(updates: &str) -> Result<Settings, String> {
    // Load current settings or create new ones
    let mut settings = init_settings().await?;

    // Parse updates into a HashMap
    let updates: HashMap<String, toml::Value> = parse_updates(updates)?;
    apply_numeric_updates(&mut settings, &updates);

    if let Some(val) = updates.get("date_created").and_then(|v| v.as_str()) {
        settings.date_created = val.to_string();
    }

    // Apply updates (only fields that were provided)
    if let Some(val) = updates
        .get("page_speed_bulk_api_key")
        .and_then(|v| v.as_str())
    {
        settings.page_speed_bulk_api_key = Some(Some(val.to_string()));
    }

    if let Some(val) = updates.get("list_mode").and_then(|v| v.as_bool()) {
        settings.list_mode = val;
    }
    if let Some(val) = updates.get("list_urls").and_then(|v| v.as_array()) {
        settings.list_urls = val
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.trim().to_string()))
            .filter(|s| !s.is_empty())
            .collect();
    }

    if let Some(val) = updates.get("user_agents").and_then(|v| v.as_array()) {
        settings.user_agents = val
            .iter()
            .filter_map(|v| v.as_str())
            .map(|s| s.to_string())
            .collect();
    }
    if let Some(val) = updates.get("http_user_agent").and_then(|v| v.as_str()) {
        settings.http_user_agent = val.trim().to_string();
    }
    if let Some(val) = updates.get("open_page_rank_api_key").and_then(|v| v.as_str()) {
        settings.open_page_rank_api_key = val.trim().to_string();
    }
    if let Some(val) = updates.get("robots_user_agent").and_then(|v| v.as_str()) {
        settings.robots_user_agent = val.trim().to_string();
    }

    // Include / Exclude accept either a TOML array or a newline-separated
    // string, since the config UI edits them as a textarea.
    for (key, target) in [
        ("exclude_patterns", 0usize),
        ("include_patterns", 1usize),
    ] {
        let parsed: Option<Vec<String>> = if let Some(arr) = updates.get(key).and_then(|v| v.as_array()) {
            Some(
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
            )
        } else {
            updates.get(key).and_then(|v| v.as_str()).map(|raw| {
                raw.lines()
                    .map(|l| l.trim().to_string())
                    .filter(|l| !l.is_empty())
                    .collect()
            })
        };

        if let Some(list) = parsed {
            if target == 0 {
                settings.exclude_patterns = list;
            } else {
                settings.include_patterns = list;
            }
        }
    }

    if let Some(val) = updates.get("html").and_then(|v| v.as_bool()) {
        settings.html = val;
    }

    if let Some(val) = updates.get("page_speed_bulk").and_then(|v| v.as_bool()) {
        settings.page_speed_bulk = val;
    }

    if let Some(val) = updates.get("taxonomies").and_then(|v| v.as_array()) {
        settings.taxonomies = val
            .iter()
            .filter_map(|v| v.as_str())
            .map(|s| s.to_string())
            .collect();
    }

    if let Some(val) = updates.get("extract_ngrams").and_then(|v| v.as_bool()) {
        settings.extract_ngrams = val;
    }

    if let Some(val) = updates
        .get("javascript_rendering")
        .and_then(|v| v.as_bool())
    {
        settings.javascript_rendering = val;
    }

    if let Some(val) = updates.get("link_score_enabled").and_then(|v| v.as_bool()) {
        settings.link_score_enabled = val;
    }

    if let Some(val) = updates
        .get("duplicate_content_check_enabled")
        .and_then(|v| v.as_bool())
    {
        settings.duplicate_content_check_enabled = val;
    }

    if let Some(val) = updates.get("adaptive_crawling").and_then(|v| v.as_bool()) {
        settings.adaptive_crawling = val;
    }

    if let Some(val) = updates.get("indexing_bots").and_then(|v| v.as_array()) {
        settings.indexing_bots = val
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }

    if let Some(val) = updates.get("retrieval_agents").and_then(|v| v.as_array()) {
        settings.retrieval_agents = val
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }

    if let Some(val) = updates.get("agentic_bots").and_then(|v| v.as_array()) {
        settings.agentic_bots = val
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }

    if let Some(val) = updates.get("axum_api_server").and_then(|v| v.as_bool()) {
        settings.axum_api_server = val;
    }

    if let Some(val) = updates.get("axum_api_server_host").and_then(|v| v.as_str()) {
        settings.axum_api_host = val.to_string();
    }

    if let Some(val) = updates.get("log_bots").and_then(|v| v.as_array()) {
        settings.log_bots = val
            .iter()
            .filter_map(|v| {
                if let Some(arr) = v.as_array() {
                    if arr.len() == 2 {
                        let display = arr[0].as_str()?.to_string();
                        let bot = arr[1].as_str()?.to_string();
                        return Some((display, bot));
                    }
                }
                None
            })
            .collect();
    }

    settings.normalize_migrated();
    persist_settings(&settings).await?;

    Ok(settings)
}

fn parse_updates(updates: &str) -> Result<HashMap<String, toml::Value>, String> {
    if let Ok(json_updates) =
        serde_json::from_str::<HashMap<String, serde_json::Value>>(updates)
    {
        return json_updates
            .into_iter()
            .map(|(key, value)| {
                let value_name = key.clone();
                toml::Value::try_from(value)
                    .map(|value| (key, value))
                    .map_err(|e| format!("Invalid value for {value_name}: {e}"))
            })
            .collect();
    }

    toml::from_str(updates).map_err(|e| format!("Failed to parse updates: {}", e))
}

#[tauri::command]
pub async fn get_indexing_bots_command() -> Result<Vec<String>, String> {
    let settings = load_settings().await?;
    Ok(settings.indexing_bots)
}

#[tauri::command]
pub async fn get_retrieval_agents_command() -> Result<Vec<String>, String> {
    let settings = load_settings().await?;
    Ok(settings.retrieval_agents)
}

#[tauri::command]
pub async fn get_agentic_bots_command() -> Result<Vec<String>, String> {
    let settings = load_settings().await?;
    Ok(settings.agentic_bots)
}

#[tauri::command]
pub async fn get_project_chunk_size_command() -> Result<usize, String> {
    let settings = load_settings().await?;
    Ok(settings.log_project_chunk_size)
}

#[tauri::command]
pub async fn get_log_file_upload_size_command() -> Result<usize, String> {
    let settings = load_settings().await?;
    Ok(settings.log_file_upload_size)
}

#[tauri::command]
pub fn get_system() -> Result<Value, String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    Ok(json!({
        "totalMemory": sys.total_memory(),
        "usedMemory": sys.used_memory(),
        "totalSwap": sys.total_swap(),
        "usedSwap": sys.used_swap(),

        // System Information
        "systemName": sys.name(),
        "kernelVersion" : sys.kernel_version(),
        "osVersion": sys.os_version(),
        "hostName": sys.host_name(),
        "cpus": sys.cpus().len(),

    }))
}

// REMOVE ALL THE FOLDERS IN THE CONFIG PATH
#[tauri::command]
pub async fn delete_config_folders_command() -> Result<(), String> {
    let config_path = crate::app_dirs::config_dir()?;
    if config_path.exists() {
        fs::remove_dir_all(&config_path)
            .await
            .map_err(|e| format!("Failed to delete config directory: {}", e))?;
        println!("✅ Config directory deleted at {:?}", config_path);
    } else {
        println!("⚠️ Config directory does not exist at {:?}", config_path);
    }
    Ok(())
}

// OPEN THE CONFIG FOLDER IN THE FILE EXPLORER
#[tauri::command]
pub fn open_config_folder_command() -> Result<(), String> {
    let config_path = crate::app_dirs::project_dirs()
        .ok_or("Failed to determine config directory".to_string())?
        .config_dir()
        .to_path_buf();

    if config_path.exists() {
        if cfg!(target_os = "windows") {
            std::process::Command::new("explorer")
                .arg(config_path)
                .spawn()
                .map_err(|e| format!("Failed to open config folder: {}", e))?;
        } else if cfg!(target_os = "macos") {
            std::process::Command::new("open")
                .arg(config_path)
                .spawn()
                .map_err(|e| format!("Failed to open config folder: {}", e))?;
        } else if cfg!(target_os = "linux") {
            std::process::Command::new("xdg-open")
                .arg(config_path)
                .spawn()
                .map_err(|e| format!("Failed to open config folder: {}", e))?;
        }
        Ok(())
    } else {
        Err("Config folder does not exist".to_string())
    }
}

// COMMAND TO GET ANY SETTINGS INTO THE FRONT END TO BE USED
#[tauri::command]
pub async fn get_settings_command() -> Result<Settings, String> {
    let settings = init_settings().await?;
    Ok(settings)
}

#[tauri::command]
pub async fn update_settings_command(
    updates: String,
    settings_state: tauri::State<'_, crate::AppState>,
) -> Result<Settings, String> {
    let updated_settings = override_settings(&updates).await?;

    let mut settings_lock = settings_state.settings.write().await;
    *settings_lock = updated_settings.clone();

    println!("Settings updated via GUI");

    Ok(updated_settings)
}

#[tauri::command]
pub async fn toggle_javascript_rendering(
    value: bool,
    app_handle: tauri::AppHandle,
    settings_state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let state = format!("javascript_rendering = {}", value);

    let updated_settings = override_settings(&state).await?;

    let mut settings_lock = settings_state.settings.write().await;
    *settings_lock = updated_settings;

    println!("Javascript Rendering set to: {}", value);

    use tauri::Emitter;
    app_handle
        .emit("javascript-rendering-toggled", value)
        .map_err(|e| format!("Failed to emit event: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_are_already_normalized() {
        let mut settings = Settings::new();
        assert!(!settings.normalize_migrated());
    }

    #[test]
    fn normalization_repairs_zero_capacities_and_dangerous_extremes() {
        let mut settings = Settings::new();
        settings.concurrent_requests = 0;
        settings.batch_size = 0;
        settings.javascript_concurrency = 0;
        settings.links_max_concurrent_requests = 0;
        settings.links_initial_task_capacity = 0;
        settings.db_batch_size = 0;
        settings.db_chunk_size_domain_crawler = 0;
        settings.max_depth = usize::MAX;
        settings.max_urls_per_domain = 0;
        settings.max_urls_stored = 0;
        settings.max_retries = u32::MAX;
        settings.links_max_retries = usize::MAX;
        settings.client_timeout = 0;
        settings.client_connect_timeout = u64::MAX;
        settings.crawl_timeout = 0;
        settings.max_pending_time = 0;
        settings.stall_check_interval = 0;
        settings.links_request_timeout = 0;
        settings.links_pool_idle_timeout = 0;
        settings.links_max_idle_per_host = 0;
        settings.base_delay = 9_000;
        settings.min_crawl_delay = 8_000;
        settings.max_delay = 1;
        settings.links_jitter_factor = f32::INFINITY;
        settings.log_batchsize = 0;
        settings.log_chunk_size = 0;
        settings.log_sleep_stream_duration = 0;
        settings.log_capacity = 0;
        settings.log_project_chunk_size = 0;
        settings.log_file_upload_size = 0;
        settings.gsc_row_limit = 0;
        settings.axum_api_port = 0;
        settings.axum_api_host = "   ".to_string();

        assert!(settings.normalize_migrated());
        assert_eq!(settings.concurrent_requests, 1);
        assert_eq!(settings.batch_size, 1);
        assert_eq!(settings.javascript_concurrency, 1);
        assert_eq!(settings.links_max_concurrent_requests, 1);
        assert_eq!(settings.links_initial_task_capacity, 1);
        assert_eq!(settings.db_batch_size, 1);
        assert_eq!(settings.db_chunk_size_domain_crawler, 1);
        assert_eq!(settings.max_depth, 1_000);
        assert_eq!(settings.max_urls_per_domain, 1);
        assert_eq!(settings.max_urls_stored, 100);
        assert_eq!(settings.max_retries, MAX_RETRIES);
        assert_eq!(settings.links_max_retries, MAX_LINK_RETRIES);
        assert_eq!(settings.client_timeout, 1);
        assert_eq!(settings.client_connect_timeout, 1);
        assert_eq!(settings.crawl_timeout, 1);
        assert_eq!(settings.max_pending_time, 1);
        assert_eq!(settings.stall_check_interval, 1);
        assert_eq!(settings.links_request_timeout, 1);
        assert_eq!(settings.links_pool_idle_timeout, 1);
        assert_eq!(settings.links_max_idle_per_host, 1);
        assert_eq!(settings.max_delay, 9_000);
        assert_eq!(settings.links_jitter_factor, 0.6);
        assert_eq!(settings.log_batchsize, 1);
        assert_eq!(settings.log_chunk_size, 1);
        assert_eq!(settings.log_sleep_stream_duration, 1);
        assert_eq!(settings.log_capacity, 1);
        assert_eq!(settings.log_project_chunk_size, 1);
        assert_eq!(settings.log_file_upload_size, 1);
        assert_eq!(settings.gsc_row_limit, 1);
        assert_eq!(settings.axum_api_port, 3000);
        assert_eq!(settings.axum_api_host, "127.0.0.1");
    }

    #[test]
    fn negative_json_updates_never_wrap_to_unsigned_maxima() {
        let updates = parse_updates(
            r#"{
                "concurrent_requests": -1,
                "batch_size": -2,
                "db_batch_size": -3,
                "javascript_concurrency": -4,
                "links_max_concurrent_requests": -5,
                "client_timeout": -6,
                "crawl_timeout": -7,
                "max_retries": -8,
                "base_delay": -9,
                "max_urls_per_domain": -10,
                "max_urls_stored": -11,
                "gsc_row_limit": -12,
                "axum_api_port": -13
            }"#,
        )
        .expect("negative JSON should still parse as signed integers");
        let mut settings = Settings::new();

        apply_numeric_updates(&mut settings, &updates);

        assert_eq!(settings.concurrent_requests, 0);
        assert_eq!(settings.batch_size, 0);
        assert_eq!(settings.db_batch_size, 0);
        assert_eq!(settings.javascript_concurrency, 0);
        assert_eq!(settings.links_max_concurrent_requests, 0);
        assert_eq!(settings.client_timeout, 0);
        assert_eq!(settings.crawl_timeout, 0);
        assert_eq!(settings.max_retries, 0);
        assert_eq!(settings.base_delay, 0);
        assert_eq!(settings.max_urls_per_domain, 0);
        assert_eq!(settings.max_urls_stored, 0);
        assert_eq!(settings.gsc_row_limit, 0);
        assert_eq!(settings.axum_api_port, 0);

        settings.normalize_migrated();
        assert_eq!(settings.concurrent_requests, 1);
        assert_eq!(settings.batch_size, 1);
        assert_eq!(settings.db_batch_size, 1);
        assert_eq!(settings.javascript_concurrency, 1);
        assert_eq!(settings.links_max_concurrent_requests, 1);
        assert_eq!(settings.client_timeout, 1);
        assert_eq!(settings.crawl_timeout, 1);
        assert_eq!(settings.max_urls_per_domain, 1);
        assert_eq!(settings.max_urls_stored, 100);
        assert_eq!(settings.gsc_row_limit, 1);
        assert_eq!(settings.axum_api_port, 3000);
    }

    #[test]
    fn normalization_enforces_timeout_delay_and_pool_relationships() {
        let updates = parse_updates(
            r#"
                concurrent_requests = 4
                links_max_concurrent_requests = 2
                links_max_idle_per_host = 100
                client_timeout = 30
                client_connect_timeout = 90
                crawl_timeout = 10
                max_pending_time = 5
                stall_check_interval = 99
                base_delay = 100
                min_crawl_delay = 200
                max_delay = 1
            "#,
        )
        .unwrap();
        let mut settings = Settings::new();
        apply_numeric_updates(&mut settings, &updates);

        settings.normalize_migrated();

        assert_eq!(settings.client_connect_timeout, 30);
        assert_eq!(settings.crawl_timeout, 30);
        assert_eq!(settings.max_pending_time, 30);
        assert_eq!(settings.stall_check_interval, 30);
        assert_eq!(settings.max_delay, 200);
        assert_eq!(settings.links_max_idle_per_host, 2);
    }

    #[test]
    fn oversized_updates_saturate_then_normalize_to_documented_limits() {
        let updates = parse_updates(&format!(
            "concurrent_requests = {}\nmax_retries = {}\naxum_api_port = {}",
            i64::MAX,
            i64::MAX,
            i64::MAX
        ))
        .unwrap();
        let mut settings = Settings::new();
        apply_numeric_updates(&mut settings, &updates);
        settings.normalize_migrated();

        assert_eq!(settings.concurrent_requests, MAX_CRAWL_CONCURRENCY);
        assert_eq!(settings.max_retries, MAX_RETRIES);
        assert_eq!(settings.axum_api_port, u16::MAX);
    }
}
