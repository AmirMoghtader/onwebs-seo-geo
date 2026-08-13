use futures::StreamExt;
use regex::Regex;
use reqwest::Client;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::sync::{OnceCell, Semaphore};
use url::Url;

pub const DEFAULT_ROBOTS_CACHE_CAPACITY: usize = 256;
const MAX_ROBOTS_CACHE_CAPACITY: usize = 1_024;
const MAX_ROBOTS_BYTES: usize = 2 * 1024 * 1024;

/// robots.txt is fetched once per origin and memoised for the whole crawl, so
/// a transient failure is worth retrying before it decides anything.
const ROBOTS_FETCH_ATTEMPTS: u32 = 3;
const ROBOTS_RETRY_BASE_MS: u64 = 300;
const MAX_ROBOTS_REDIRECTS: usize = 10;
const MAX_PARALLEL_ROBOTS_FETCHES: usize = 8;

#[derive(Clone, Debug)]
struct RobotsRule {
    allow: bool,
    pattern: String,
    matcher: Regex,
    specificity: usize,
}

/// The rules selected for one robots User-Agent. A policy with no rules allows
/// every URL, which is also the correct behaviour when robots.txt is absent.
#[derive(Clone, Debug, Default)]
pub struct RobotsPolicy {
    rules: Vec<RobotsRule>,
}

impl RobotsPolicy {
    pub fn is_allowed(&self, url: &str) -> bool {
        let path = Url::parse(url)
            .map(|parsed| match parsed.query() {
                Some(query) => format!("{}?{}", parsed.path(), query),
                None => parsed.path().to_string(),
            })
            .unwrap_or_else(|_| url.to_string());

        // The most-specific matching rule wins. An Allow wins a tie, as
        // defined by the robots exclusion protocol.
        self.rules
            .iter()
            .filter(|rule| rule.matcher.is_match(&path))
            .max_by(|left, right| {
                left.specificity
                    .cmp(&right.specificity)
                    .then_with(|| left.allow.cmp(&right.allow))
            })
            .map(|rule| rule.allow)
            .unwrap_or(true)
    }

    pub fn disallow_patterns(&self) -> impl Iterator<Item = &str> {
        self.rules
            .iter()
            .filter(|rule| !rule.allow)
            .map(|rule| rule.pattern.as_str())
    }

    fn disallow_all() -> Self {
        Self {
            rules: compile_rule(false, "/").into_iter().collect(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct RobotsData {
    pub raw_text: Vec<String>,
    pub blocked_urls: Vec<String>,
    pub sitemap_urls: Vec<String>,
    pub policy: RobotsPolicy,
}

#[derive(Clone, Debug, Default)]
struct CachedRobots {
    data: Option<RobotsData>,
    policy: RobotsPolicy,
}

/// Why a robots.txt lookup did not produce a policy.
///
/// The distinction matters: a server error is the site failing to answer and
/// RFC 9309 says to hold off, while a transport error is *us* being unable to
/// connect and must not be read as a crawl ban.
enum RobotsFetchError {
    /// The server answered, badly: 5xx or 429.
    Server(String),
    /// We never got an answer: DNS, TLS, timeout, no route.
    Transport(String),
}

impl std::fmt::Display for RobotsFetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Server(detail) | Self::Transport(detail) => f.write_str(detail),
        }
    }
}

impl CachedRobots {
    fn from_data(data: Option<RobotsData>) -> Self {
        let policy = data
            .as_ref()
            .map(|value| value.policy.clone())
            .unwrap_or_default();
        Self { data, policy }
    }

    fn unreachable() -> Self {
        Self {
            data: None,
            policy: RobotsPolicy::disallow_all(),
        }
    }

    /// Used when we could not reach robots.txt at all — DNS failure, timeout,
    /// TLS error, a dropped VPN. That is our connectivity failing, not the site
    /// telling us to stay out, so it must not ban the whole origin. RFC 9309's
    /// complete-disallow rule is about *server* errors (5xx/429), which are
    /// still handled by `unreachable()` above.
    fn undetermined() -> Self {
        Self {
            data: None,
            policy: RobotsPolicy::default(),
        }
    }
}

#[derive(Default)]
struct RobotsCacheInner {
    entries: HashMap<String, Arc<OnceCell<CachedRobots>>>,
    insertion_order: VecDeque<String>,
}

/// Bounded, single-flight cache of robots policies keyed by serialized origin
/// (`scheme://host:port`). Each origin fetches its own `/robots.txt`; a policy
/// can therefore never leak from the start host to a redirect or subdomain.
pub struct RobotsPolicyCache {
    client: Client,
    robots_user_agent: Arc<str>,
    capacity: usize,
    entries: StdMutex<RobotsCacheInner>,
    fetch_slots: Arc<Semaphore>,
}

impl RobotsPolicyCache {
    /// Build a dedicated metadata client. Its HTTP User-Agent is the configured
    /// robots agent and redirects are deliberately enabled for metadata even
    /// though the page crawler tracks redirects manually.
    pub fn new(
        robots_user_agent: impl Into<String>,
        request_timeout: Duration,
        connect_timeout: Duration,
        capacity: usize,
    ) -> Result<Self, reqwest::Error> {
        let robots_user_agent = robots_user_agent.into();
        let robots_user_agent = robots_user_agent.trim();
        let robots_user_agent = if robots_user_agent.is_empty() {
            "OnwebsSEO"
        } else {
            robots_user_agent
        };
        let client = Client::builder()
            .user_agent(robots_user_agent)
            .timeout(request_timeout)
            .connect_timeout(connect_timeout)
            .redirect(reqwest::redirect::Policy::limited(MAX_ROBOTS_REDIRECTS))
            .build()?;

        Ok(Self {
            client,
            robots_user_agent: Arc::from(robots_user_agent.to_string()),
            capacity: capacity.clamp(1, MAX_ROBOTS_CACHE_CAPACITY),
            entries: StdMutex::new(RobotsCacheInner::default()),
            fetch_slots: Arc::new(Semaphore::new(MAX_PARALLEL_ROBOTS_FETCHES)),
        })
    }

    /// Load (or reuse) the robots metadata for the URL's exact origin.
    pub async fn robots_data_for(&self, url: &Url) -> Option<RobotsData> {
        self.cached_for(url).await.data
    }

    /// Evaluate a URL after asynchronously ensuring its exact origin policy is
    /// cached. Unsupported/opaque URL origins are allowed for compatibility;
    /// the crawler's URL validation rejects them separately.
    pub async fn is_allowed(&self, url: &Url) -> bool {
        self.cached_for(url).await.policy.is_allowed(url.as_str())
    }

    /// Evaluate only if this origin has already completed metadata loading.
    /// `None` means callers must use [`Self::is_allowed`] before an actual fetch.
    pub fn is_allowed_cached(&self, url: &Url) -> Option<bool> {
        let origin = origin_key(url)?;
        let cell = {
            let inner = self
                .entries
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            inner.entries.get(&origin).cloned()
        }?;
        cell.get()
            .map(|cached| cached.policy.is_allowed(url.as_str()))
    }

    /// Seed a parsed policy without network I/O. This is useful when callers
    /// already loaded the start-origin metadata, and for deterministic tests.
    pub fn seed_policy(&self, url: &Url, policy: RobotsPolicy) -> bool {
        let Some((_, cell)) = self.cell_for(url) else {
            return false;
        };
        cell.set(CachedRobots { data: None, policy }).is_ok()
    }

    #[cfg(test)]
    fn cached_origin_count(&self) -> usize {
        self.entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .entries
            .len()
    }

    async fn cached_for(&self, url: &Url) -> CachedRobots {
        let Some((robots_url, cell)) = self.cell_for(url) else {
            return CachedRobots::default();
        };
        let origin = origin_key(url).unwrap_or_default();

        cell.get_or_init(|| async {
            let _permit = self.fetch_slots.acquire().await.ok();

            // One flaky request must not decide the fate of a whole origin:
            // the result is memoised for the entire crawl, so a single dropped
            // packet used to ban every URL on the site.
            let mut last: Option<RobotsFetchError> = None;
            for attempt in 0..ROBOTS_FETCH_ATTEMPTS {
                match self.fetch_origin(&robots_url, &origin).await {
                    Ok(cached) => return cached,
                    Err(error) => {
                        if attempt + 1 < ROBOTS_FETCH_ATTEMPTS {
                            tokio::time::sleep(Duration::from_millis(
                                ROBOTS_RETRY_BASE_MS << attempt,
                            ))
                            .await;
                        }
                        last = Some(error);
                    }
                }
            }

            match last {
                // RFC 9309 section 2.3.1.4: the site answered with a server
                // error, so hold off crawling it for now.
                Some(RobotsFetchError::Server(detail)) => {
                    tracing::warn!(
                        "robots.txt for {} returned {} after {} attempts — treating as disallow",
                        origin, detail, ROBOTS_FETCH_ATTEMPTS
                    );
                    CachedRobots::unreachable()
                }
                // We could not reach it at all. Blocking here would turn our own
                // connectivity problem into "this site forbids crawling", which
                // is what made a whole crawl die at 0% on a flaky link or VPN.
                Some(RobotsFetchError::Transport(detail)) => {
                    tracing::warn!(
                        "Could not reach robots.txt for {} after {} attempts ({}). \
                         Continuing without robots rules — check your connection if \
                         this repeats.",
                        origin, ROBOTS_FETCH_ATTEMPTS, detail
                    );
                    CachedRobots::undetermined()
                }
                None => CachedRobots::default(),
            }
        })
        .await
        .clone()
    }

    fn cell_for(&self, url: &Url) -> Option<(Url, Arc<OnceCell<CachedRobots>>)> {
        let origin = origin_key(url)?;
        let robots_url = Url::parse(&format!("{origin}/robots.txt")).ok()?;
        let mut inner = self
            .entries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if let Some(cell) = inner.entries.get(&origin) {
            return Some((robots_url, cell.clone()));
        }

        while inner.entries.len() >= self.capacity {
            let Some(oldest) = inner.insertion_order.pop_front() else {
                break;
            };
            inner.entries.remove(&oldest);
        }

        let cell = Arc::new(OnceCell::new());
        inner.entries.insert(origin.clone(), cell.clone());
        inner.insertion_order.push_back(origin);
        Some((robots_url, cell))
    }

    async fn fetch_origin(
        &self,
        robots_url: &Url,
        requested_origin: &str,
    ) -> Result<CachedRobots, RobotsFetchError> {
        let response = self
            .client
            .get(robots_url.clone())
            .send()
            .await
            .map_err(|error| RobotsFetchError::Transport(error.to_string()))?;
        let status = response.status();

        // RFC 9309 treats 4xx (except an explicit rate limit) as unavailable,
        // which permits crawling. Server failures and 429 are unreachable and
        // return an error so cached_for applies complete-disallow temporarily.
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
            return Err(RobotsFetchError::Server(format!("HTTP {}", status)));
        }
        if status.is_client_error() {
            return Ok(CachedRobots::default());
        }
        if !status.is_success() {
            return Err(RobotsFetchError::Server(format!("HTTP {}", status)));
        }

        let mut body = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| RobotsFetchError::Transport(e.to_string()))?;
            if body.len().saturating_add(chunk.len()) > MAX_ROBOTS_BYTES {
                return Err(RobotsFetchError::Server(format!(
                    "robots.txt exceeds the {} byte safety limit",
                    MAX_ROBOTS_BYTES
                )));
            }
            body.extend_from_slice(&chunk);
        }

        let body = String::from_utf8_lossy(&body).into_owned();
        if body.trim().is_empty() {
            return Ok(CachedRobots::default());
        }
        let data = robots_data_from_body(
            body,
            requested_origin,
            self.robots_user_agent.as_ref(),
        );
        Ok(CachedRobots::from_data(Some(data)))
    }
}

fn origin_key(url: &Url) -> Option<String> {
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        return None;
    }
    Some(url.origin().ascii_serialization())
}

#[derive(Default)]
struct RobotsGroup {
    agents: Vec<String>,
    rules: Vec<(bool, String)>,
    has_directives: bool,
}

/// Fetch robots.txt with the same configured HTTP client as the crawl, then
/// select rules with the independently configured robots User-Agent.
pub async fn get_robots_data(
    base_url: &Url,
    client: &Client,
    robots_user_agent: &str,
) -> Option<RobotsData> {
    let robots_url = base_url.join("/robots.txt").ok()?;
    let response = client.get(robots_url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }

    let body = response.text().await.ok()?;
    if body.trim().is_empty() {
        return None;
    }

    let origin = base_url.origin().ascii_serialization();
    Some(robots_data_from_body(body, &origin, robots_user_agent))
}

fn robots_data_from_body(
    body: String,
    origin: &str,
    robots_user_agent: &str,
) -> RobotsData {
    let (policy, sitemap_urls) = parse_robots(&body, robots_user_agent);
    let blocked_urls = policy
        .disallow_patterns()
        .map(|pattern| {
            if pattern.starts_with('/') {
                format!("{origin}{pattern}")
            } else {
                pattern.to_string()
            }
        })
        .collect();

    RobotsData {
        raw_text: vec![body],
        blocked_urls,
        sitemap_urls,
        policy,
    }
}

pub fn parse_robots(body: &str, robots_user_agent: &str) -> (RobotsPolicy, Vec<String>) {
    let mut groups = Vec::<RobotsGroup>::new();
    let mut current = RobotsGroup::default();
    let mut sitemap_urls = Vec::new();

    for original_line in body.lines() {
        let line = original_line
            .trim_start_matches('\u{feff}')
            .split('#')
            .next()
            .unwrap_or_default()
            .trim();
        let Some((name, raw_value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_ascii_lowercase();
        let value = raw_value.trim();

        match name.as_str() {
            "user-agent" if !value.is_empty() => {
                // Consecutive User-Agent lines form one group. A User-Agent
                // after directives begins a new group.
                if current.has_directives && !current.agents.is_empty() {
                    groups.push(current);
                    current = RobotsGroup::default();
                }
                current.agents.push(value.to_ascii_lowercase());
            }
            "allow" | "disallow" if !current.agents.is_empty() => {
                current.has_directives = true;
                // An empty Disallow means "allow all" and is not a rule.
                if !value.is_empty() {
                    current.rules.push((name == "allow", value.to_string()));
                }
            }
            "sitemap" if !value.is_empty() => {
                if Url::parse(value).is_ok() && !sitemap_urls.iter().any(|url| url == value) {
                    sitemap_urls.push(value.to_string());
                }
            }
            _ => {}
        }
    }
    if !current.agents.is_empty() {
        groups.push(current);
    }

    let requested_agent = robots_user_agent.trim().to_ascii_lowercase();
    let direct_score = |group: &RobotsGroup| {
        group
            .agents
            .iter()
            .filter(|agent| agent.as_str() != "*" && requested_agent.contains(agent.as_str()))
            .map(String::len)
            .max()
    };
    let best_specific = groups.iter().filter_map(direct_score).max();

    let selected_rules = groups
        .iter()
        .filter(|group| match best_specific {
            Some(best) => direct_score(group) == Some(best),
            None => group.agents.iter().any(|agent| agent == "*"),
        })
        .flat_map(|group| group.rules.iter())
        .filter_map(|(allow, pattern)| compile_rule(*allow, pattern))
        .collect();

    (
        RobotsPolicy {
            rules: selected_rules,
        },
        sitemap_urls,
    )
}

fn compile_rule(allow: bool, pattern: &str) -> Option<RobotsRule> {
    let anchored_at_end = pattern.ends_with('$');
    let raw = pattern.strip_suffix('$').unwrap_or(pattern);
    let escaped = regex::escape(raw).replace("\\*", ".*");
    let expression = if anchored_at_end {
        format!("^{escaped}$")
    } else {
        format!("^{escaped}")
    };

    Some(RobotsRule {
        allow,
        pattern: pattern.to_string(),
        matcher: Regex::new(&expression).ok()?,
        specificity: pattern
            .chars()
            .filter(|character| *character != '*' && *character != '$')
            .count(),
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_robots, RobotsPolicyCache};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use url::Url;

    /// A crawl must not die because we could not reach robots.txt.
    ///
    /// Port 1 on loopback refuses instantly, which is the transport failure a
    /// dropped VPN or flaky link produces. Before this, that answer was cached
    /// as complete-disallow and every URL on the origin was blocked — a whole
    /// crawl finishing at 0% with one "Blocked by robots.txt" error.
    #[tokio::test]
    async fn unreachable_robots_does_not_block_the_origin() {
        let cache = RobotsPolicyCache::new(
            "OnwebsBot",
            Duration::from_millis(400),
            Duration::from_millis(400),
            8,
        )
        .unwrap();

        let url = Url::parse("http://127.0.0.1:1/some/page").unwrap();
        assert!(
            cache.is_allowed(&url).await,
            "a robots.txt we cannot reach must not ban the site"
        );
    }

    async fn test_server(
        responses: Vec<String>,
    ) -> (
        String,
        Arc<Mutex<Vec<String>>>,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = requests.clone();
        let handle = tokio::spawn(async move {
            for response in responses {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buffer = [0_u8; 2_048];
                loop {
                    let read = socket.read(&mut buffer).await.unwrap();
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..read]);
                    if request.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                captured
                    .lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&request).into_owned());
                socket.write_all(response.as_bytes()).await.unwrap();
                socket.shutdown().await.unwrap();
            }
        });
        (origin, requests, handle)
    }

    fn ok_response(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
    }

    #[test]
    fn selects_the_configured_agent_instead_of_combining_every_group() {
        let body = r#"
            User-agent: *
            Disallow: /private/
            Allow: /private/public/
            Sitemap: https://example.com/sitemap.xml

            User-agent: OnwebsSEO
            Disallow: /crawler-only/
        "#;

        let (onwebs, sitemaps) = parse_robots(body, "OnwebsSEO");
        assert!(onwebs.is_allowed("https://example.com/private/secret"));
        assert!(!onwebs.is_allowed("https://example.com/crawler-only/page"));
        assert_eq!(sitemaps, vec!["https://example.com/sitemap.xml"]);

        let (generic, _) = parse_robots(body, "OtherBot");
        assert!(!generic.is_allowed("https://example.com/private/secret"));
        assert!(generic.is_allowed("https://example.com/private/public/page"));
    }

    #[test]
    fn supports_wildcards_end_anchors_and_allow_ties() {
        let body = r#"
            User-agent: *
            Disallow: /*?session=
            Disallow: /download/*.zip$
            Allow: /download/public.zip$
        "#;
        let (policy, _) = parse_robots(body, "AnyBot");

        assert!(!policy.is_allowed("https://example.com/page?session=1"));
        assert!(!policy.is_allowed("https://example.com/download/private.zip"));
        assert!(policy.is_allowed("https://example.com/download/private.zip?mirror=1"));
        assert!(policy.is_allowed("https://example.com/download/public.zip"));
    }

    #[tokio::test]
    async fn policies_are_cached_per_origin_and_use_the_configured_user_agent() {
        let (origin_a, requests_a, server_a) = test_server(vec![ok_response(
            "User-agent: OriginBot\nDisallow: /private\nAllow: /private/public",
        )])
        .await;
        let (origin_b, requests_b, server_b) = test_server(vec![ok_response(
            "User-agent: OriginBot\nDisallow: /other",
        )])
        .await;
        let cache = RobotsPolicyCache::new(
            "OriginBot",
            Duration::from_secs(2),
            Duration::from_secs(2),
            8,
        )
        .unwrap();

        let a_private = Url::parse(&format!("{origin_a}/private/secret")).unwrap();
        let a_public = Url::parse(&format!("{origin_a}/private/public/page")).unwrap();
        let a_other = Url::parse(&format!("{origin_a}/other")).unwrap();
        let b_private = Url::parse(&format!("{origin_b}/private/secret")).unwrap();
        let b_other = Url::parse(&format!("{origin_b}/other")).unwrap();

        assert!(!cache.is_allowed(&a_private).await);
        assert!(cache.is_allowed(&a_public).await);
        assert!(cache.is_allowed(&a_other).await);
        assert!(cache.is_allowed(&b_private).await);
        assert!(!cache.is_allowed(&b_other).await);
        assert_eq!(cache.cached_origin_count(), 2);

        server_a.await.unwrap();
        server_b.await.unwrap();
        let all_requests: Vec<String> = requests_a
            .lock()
            .unwrap()
            .iter()
            .chain(requests_b.lock().unwrap().iter())
            .cloned()
            .collect();
        for request in all_requests {
            let lower = request.to_ascii_lowercase();
            assert!(lower.starts_with("get /robots.txt "));
            assert!(lower.contains("\r\nuser-agent: originbot\r\n"));
        }
    }

    #[tokio::test]
    async fn concurrent_origin_lookups_are_single_flight() {
        let (origin, requests, server) = test_server(vec![ok_response(
            "User-agent: *\nDisallow: /private",
        )])
        .await;
        let cache = Arc::new(
            RobotsPolicyCache::new(
                "SingleFlightBot",
                Duration::from_secs(2),
                Duration::from_secs(2),
                8,
            )
            .unwrap(),
        );
        let url = Url::parse(&format!("{origin}/private/page")).unwrap();
        let lookups = (0..16).map(|_| {
            let cache = cache.clone();
            let url = url.clone();
            async move { cache.is_allowed(&url).await }
        });

        let results = futures::future::join_all(lookups).await;
        assert!(results.iter().all(|allowed| !allowed));
        server.await.unwrap();
        assert_eq!(requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn metadata_client_follows_robots_redirects() {
        let redirect = concat!(
            "HTTP/1.1 302 Found\r\n",
            "Location: /policy.txt\r\n",
            "Content-Length: 0\r\n",
            "Connection: close\r\n\r\n"
        )
        .to_string();
        let (origin, requests, server) = test_server(vec![
            redirect,
            ok_response("User-agent: *\nDisallow: /redirected"),
        ])
        .await;
        let cache = RobotsPolicyCache::new(
            "RedirectBot",
            Duration::from_secs(2),
            Duration::from_secs(2),
            8,
        )
        .unwrap();
        let blocked = Url::parse(&format!("{origin}/redirected/page")).unwrap();

        assert!(!cache.is_allowed(&blocked).await);
        server.await.unwrap();
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].starts_with("GET /robots.txt "));
        assert!(requests[1].starts_with("GET /policy.txt "));
    }

    #[test]
    fn origin_cache_is_bounded() {
        let cache = RobotsPolicyCache::new(
            "BoundedBot",
            Duration::from_secs(2),
            Duration::from_secs(2),
            2,
        )
        .unwrap();
        let (policy, _) = parse_robots("User-agent: *\nDisallow: /private", "BoundedBot");
        let first = Url::parse("http://127.0.0.1:31001/private").unwrap();
        let second = Url::parse("http://127.0.0.1:31002/private").unwrap();
        let third = Url::parse("http://127.0.0.1:31003/private").unwrap();

        assert!(cache.seed_policy(&first, policy.clone()));
        assert!(cache.seed_policy(&second, policy.clone()));
        assert!(cache.seed_policy(&third, policy));
        assert_eq!(cache.cached_origin_count(), 2);
        assert_eq!(cache.is_allowed_cached(&first), None);
        assert_eq!(cache.is_allowed_cached(&second), Some(false));
        assert_eq!(cache.is_allowed_cached(&third), Some(false));
    }
}
