use std::future::Future;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use reqwest::Client;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio::time::{sleep, Instant};

use crate::settings::settings::Settings;

use super::request_throttle::{BackoffState, CrawlThrottle, WaitOutcome};

/// A successful request keeps its network permit until the caller has consumed
/// the body. Releasing the permit at headers would under-count streaming bodies
/// and allow more live connections than the configured concurrency.
pub struct FetchOutcome {
    pub response: reqwest::Response,
    pub request_seconds: f64,
    pub permit: OwnedSemaphorePermit,
    pub rate_limit: Option<BackoffState>,
}

/// Fetch a URL with bounded network concurrency, responsive pause/stop, and
/// retry semantics limited to transient failures. HTTP 403 is intentionally
/// not retried: it is a real response, not proof of rate limiting.
pub async fn fetch_with_exponential_backoff(
    client: &Client,
    url: &str,
    settings: &Settings,
    control: Option<&Arc<AtomicU8>>,
    request_semaphore: &Arc<Semaphore>,
    throttle: &Arc<CrawlThrottle>,
) -> Result<Option<FetchOutcome>, reqwest::Error> {
    let mut attempt = 0u32;
    let mut total_request_seconds = 0.0;
    let mut latest_rate_limit = None;

    loop {
        // Acquire capacity before taking a pacing slot. Otherwise several
        // callers can consume old throttle slots while queued on the semaphore
        // and then start together when permits become available.
        let permit = match acquire_permit_with_control(request_semaphore, control).await {
            Some(permit) => permit,
            None => return Ok(None),
        };

        if throttle.wait(control).await == WaitOutcome::Stopped {
            drop(permit);
            return Ok(None);
        }

        // Pause or Stop might have been requested while waiting for a network
        // slot. Do not start a request after either control transition.
        match control.map(|flag| flag.load(Ordering::Acquire)) {
            Some(2) => return Ok(None),
            Some(1) => {
                drop(permit);
                continue;
            }
            _ => {}
        }

        let started = Instant::now();
        let response = await_with_stop(client.get(url).send(), control).await;
        let Some(response) = response else {
            drop(permit);
            return Ok(None);
        };

        // Prefer Stop over a response that became ready in the same scheduler
        // tick, and release the network slot immediately.
        if control
            .map(|flag| flag.load(Ordering::Acquire) == 2)
            .unwrap_or(false)
        {
            drop(permit);
            return Ok(None);
        }

        match response {
            Ok(response) => {
                total_request_seconds += started.elapsed().as_secs_f64();
                let status = response.status();

                if status == reqwest::StatusCode::TOO_MANY_REQUESTS
                    || status == reqwest::StatusCode::SERVICE_UNAVAILABLE
                {
                    let retry_after = parse_retry_after(response.headers());
                    let backoff = throttle.on_rate_limited(retry_after);
                    latest_rate_limit = Some(backoff);

                    if attempt >= settings.max_retries {
                        return Ok(Some(FetchOutcome {
                            response,
                            request_seconds: total_request_seconds,
                            permit,
                            rate_limit: latest_rate_limit,
                        }));
                    }

                    tracing::warn!(
                        "Transient HTTP {} for {}. Retry {} after {}ms cooldown",
                        status,
                        url,
                        attempt + 1,
                        backoff.cooldown_ms
                    );
                    drop(response);
                    drop(permit);
                    attempt += 1;
                    continue;
                }

                if status.is_success() {
                    throttle.on_success();
                }
                return Ok(Some(FetchOutcome {
                    response,
                    request_seconds: total_request_seconds,
                    permit,
                    rate_limit: latest_rate_limit,
                }));
            }
            Err(error) => {
                total_request_seconds += started.elapsed().as_secs_f64();
                drop(permit);
                throttle.on_network_error();

                if attempt >= settings.max_retries {
                    return Err(error);
                }

                let base = settings.base_delay.max(250);
                let maximum = settings.max_delay.max(base);
                let delay_ms = base
                    .saturating_mul(2u64.saturating_pow(attempt))
                    .min(maximum);
                tracing::warn!(
                    "Request error for {}: {}. Retry {} in {}ms",
                    url,
                    error,
                    attempt + 1,
                    delay_ms
                );
                if !sleep_with_control(Duration::from_millis(delay_ms), control).await {
                    return Ok(None);
                }
                attempt += 1;
            }
        }
    }
}

async fn acquire_permit_with_control(
    semaphore: &Arc<Semaphore>,
    control: Option<&Arc<AtomicU8>>,
) -> Option<OwnedSemaphorePermit> {
    'acquire: loop {
        match control.map(|flag| flag.load(Ordering::Acquire)) {
            Some(2) => return None,
            Some(1) => {
                sleep(Duration::from_millis(50)).await;
                continue;
            }
            _ => {}
        }

        let acquire = semaphore.clone().acquire_owned();
        tokio::pin!(acquire);
        loop {
            tokio::select! {
                result = &mut acquire => {
                    let permit = result.ok()?;
                    match control.map(|flag| flag.load(Ordering::Acquire)) {
                        Some(2) => return None,
                        Some(1) => {
                            drop(permit);
                            continue 'acquire;
                        }
                        _ => return Some(permit),
                    }
                }
                _ = sleep(Duration::from_millis(50)) => {
                    match control.map(|flag| flag.load(Ordering::Acquire)) {
                        Some(2) => return None,
                        Some(1) => continue 'acquire,
                        _ => {}
                    }
                }
            }
        }
    }
}

async fn await_with_stop<F>(future: F, control: Option<&Arc<AtomicU8>>) -> Option<F::Output>
where
    F: Future,
{
    tokio::pin!(future);
    loop {
        tokio::select! {
            output = &mut future => return Some(output),
            _ = sleep(Duration::from_millis(50)) => {
                if control
                    .map(|flag| flag.load(Ordering::Acquire) == 2)
                    .unwrap_or(false)
                {
                    return None;
                }
            }
        }
    }
}

fn parse_retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let value = headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim();

    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }

    // HTTP-date is IMF-fixdate/RFC 2822 compatible (for example,
    // "Wed, 21 Oct 2015 07:28:00 GMT").
    let date = chrono::DateTime::parse_from_rfc2822(value).ok()?;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;
    let seconds = date.timestamp().saturating_sub(now).max(0) as u64;
    Some(Duration::from_secs(seconds))
}

/// Sleeps while honouring Pause and Stop, so a backoff cannot keep a stopped
/// crawl alive. Shared with the body-read retry in `url_processor`.
pub(crate) async fn sleep_with_control(
    duration: Duration,
    control: Option<&Arc<AtomicU8>>,
) -> bool {
    let mut remaining = duration;
    while !remaining.is_zero() {
        match control.map(|flag| flag.load(Ordering::Acquire)) {
            Some(2) => return false,
            Some(1) => {
                sleep(Duration::from_millis(50)).await;
                continue;
            }
            _ => {}
        }
        let slice = remaining.min(Duration::from_millis(50));
        sleep(slice).await;
        remaining = remaining.saturating_sub(slice);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::{fetch_with_exponential_backoff, parse_retry_after};
    use crate::domain_crawler::helpers::request_throttle::CrawlThrottle;
    use crate::settings::settings::Settings;
    use reqwest::header::{HeaderMap, HeaderValue, RETRY_AFTER};
    use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::Semaphore;
    use tokio::task::JoinHandle;

    #[derive(Clone)]
    enum Reply {
        Raw(String),
        Close,
        Hang,
    }

    struct LocalServer {
        url: String,
        requests: Arc<AtomicUsize>,
        task: JoinHandle<()>,
    }

    impl LocalServer {
        async fn start(replies: Vec<Reply>) -> Self {
            assert!(!replies.is_empty());
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let requests = Arc::new(AtomicUsize::new(0));
            let request_count = requests.clone();
            let task = tokio::spawn(async move {
                while let Ok((mut socket, _)) = listener.accept().await {
                    let index = request_count.fetch_add(1, Ordering::AcqRel);
                    let reply = replies
                        .get(index)
                        .or_else(|| replies.last())
                        .unwrap()
                        .clone();
                    tokio::spawn(async move {
                        let mut request = [0u8; 4096];
                        let _ = socket.read(&mut request).await;
                        match reply {
                            Reply::Raw(response) => {
                                let _ = socket.write_all(response.as_bytes()).await;
                                let _ = socket.shutdown().await;
                            }
                            Reply::Close => {}
                            Reply::Hang => std::future::pending::<()>().await,
                        }
                    });
                }
            });
            Self {
                url: format!("http://{address}/"),
                requests,
                task,
            }
        }
    }

    impl Drop for LocalServer {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    fn raw_response(status: &str, headers: &str, body: &str) -> Reply {
        Reply::Raw(format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
            body.len()
        ))
    }

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap()
    }

    fn test_settings(max_retries: u32) -> Settings {
        let mut settings = Settings::default();
        settings.max_retries = max_retries;
        settings.base_delay = 0;
        settings.max_delay = 30_000;
        settings
    }

    async fn wait_for_requests(counter: &AtomicUsize, expected: usize) {
        tokio::time::timeout(Duration::from_secs(1), async {
            while counter.load(Ordering::Acquire) < expected {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("local fixture did not receive the expected request");
    }

    #[test]
    fn retry_after_accepts_delta_seconds() {
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, HeaderValue::from_static("7"));
        assert_eq!(parse_retry_after(&headers), Some(Duration::from_secs(7)));
    }

    #[test]
    fn retry_after_accepts_http_date() {
        let future = chrono::Utc::now() + chrono::Duration::seconds(30);
        let mut headers = HeaderMap::new();
        headers.insert(
            RETRY_AFTER,
            HeaderValue::from_str(&future.to_rfc2822()).unwrap(),
        );
        let parsed = parse_retry_after(&headers).unwrap();
        assert!(parsed >= Duration::from_secs(28));
        assert!(parsed <= Duration::from_secs(30));
    }

    #[tokio::test]
    async fn retries_429_and_503_but_honors_zero_retry_after() {
        for status in ["429 Too Many Requests", "503 Service Unavailable"] {
            let server = LocalServer::start(vec![
                raw_response(status, "Retry-After: 0\r\n", ""),
                raw_response("200 OK", "", "ok"),
            ])
            .await;
            let semaphore = Arc::new(Semaphore::new(1));
            let throttle = Arc::new(CrawlThrottle::new(false, 0, 0, 30_000));
            let outcome = fetch_with_exponential_backoff(
                &test_client(),
                &server.url,
                &test_settings(1),
                None,
                &semaphore,
                &throttle,
            )
            .await
            .unwrap()
            .unwrap();

            assert_eq!(outcome.response.status(), reqwest::StatusCode::OK);
            assert_eq!(outcome.rate_limit.unwrap().cooldown_ms, 0);
            assert_eq!(server.requests.load(Ordering::Acquire), 2);
            assert_eq!(semaphore.available_permits(), 0);
            drop(outcome);
            assert_eq!(semaphore.available_permits(), 1);
        }
    }

    #[tokio::test]
    async fn redirect_and_403_are_returned_without_retry() {
        for (status, headers, expected) in [
            (
                "302 Found",
                "Location: /final\r\n",
                reqwest::StatusCode::FOUND,
            ),
            ("403 Forbidden", "", reqwest::StatusCode::FORBIDDEN),
        ] {
            let server = LocalServer::start(vec![raw_response(status, headers, "")]).await;
            let semaphore = Arc::new(Semaphore::new(1));
            let throttle = Arc::new(CrawlThrottle::new(false, 0, 0, 30_000));
            let outcome = fetch_with_exponential_backoff(
                &test_client(),
                &server.url,
                &test_settings(3),
                None,
                &semaphore,
                &throttle,
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(outcome.response.status(), expected);
            assert_eq!(server.requests.load(Ordering::Acquire), 1);
        }
    }

    #[tokio::test]
    async fn pause_prevents_permit_acquisition_and_request_start() {
        let server = LocalServer::start(vec![raw_response("200 OK", "", "ok")]).await;
        let semaphore = Arc::new(Semaphore::new(1));
        let throttle = Arc::new(CrawlThrottle::new(false, 0, 0, 30_000));
        let control = Arc::new(AtomicU8::new(1));
        let task = {
            let client = test_client();
            let url = server.url.clone();
            let settings = test_settings(0);
            let semaphore = semaphore.clone();
            let throttle = throttle.clone();
            let control = control.clone();
            tokio::spawn(async move {
                fetch_with_exponential_backoff(
                    &client,
                    &url,
                    &settings,
                    Some(&control),
                    &semaphore,
                    &throttle,
                )
                .await
            })
        };

        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(server.requests.load(Ordering::Acquire), 0);
        assert_eq!(semaphore.available_permits(), 1);
        control.store(0, Ordering::Release);
        let outcome = tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(outcome.response.status(), reqwest::StatusCode::OK);
    }

    #[tokio::test]
    async fn stop_interrupts_wait_for_a_semaphore_permit() {
        let semaphore = Arc::new(Semaphore::new(1));
        let held = semaphore.clone().acquire_owned().await.unwrap();
        let throttle = Arc::new(CrawlThrottle::new(false, 0, 0, 30_000));
        let control = Arc::new(AtomicU8::new(0));
        let task = {
            let client = test_client();
            let settings = test_settings(0);
            let semaphore = semaphore.clone();
            let throttle = throttle.clone();
            let control = control.clone();
            tokio::spawn(async move {
                fetch_with_exponential_backoff(
                    &client,
                    "http://127.0.0.1:1/",
                    &settings,
                    Some(&control),
                    &semaphore,
                    &throttle,
                )
                .await
            })
        };

        tokio::time::sleep(Duration::from_millis(20)).await;
        control.store(2, Ordering::Release);
        let result = tokio::time::timeout(Duration::from_millis(250), task)
            .await
            .expect("Stop must interrupt semaphore wait")
            .unwrap()
            .unwrap();
        assert!(result.is_none());
        assert_eq!(semaphore.available_permits(), 0);
        drop(held);
        assert_eq!(semaphore.available_permits(), 1);
    }

    #[tokio::test]
    async fn stop_cancels_inflight_request_and_releases_permit() {
        let server = LocalServer::start(vec![Reply::Hang]).await;
        let semaphore = Arc::new(Semaphore::new(1));
        let throttle = Arc::new(CrawlThrottle::new(false, 0, 0, 30_000));
        let control = Arc::new(AtomicU8::new(0));
        let task = {
            let client = test_client();
            let url = server.url.clone();
            let settings = test_settings(0);
            let semaphore = semaphore.clone();
            let throttle = throttle.clone();
            let control = control.clone();
            tokio::spawn(async move {
                fetch_with_exponential_backoff(
                    &client,
                    &url,
                    &settings,
                    Some(&control),
                    &semaphore,
                    &throttle,
                )
                .await
            })
        };

        wait_for_requests(&server.requests, 1).await;
        control.store(2, Ordering::Release);
        let result = tokio::time::timeout(Duration::from_millis(300), task)
            .await
            .expect("Stop must cancel an in-flight response wait")
            .unwrap()
            .unwrap();
        assert!(result.is_none());
        assert_eq!(semaphore.available_permits(), 1);
    }

    #[tokio::test]
    async fn network_error_releases_permit() {
        let server = LocalServer::start(vec![Reply::Close]).await;
        let semaphore = Arc::new(Semaphore::new(1));
        let throttle = Arc::new(CrawlThrottle::new(false, 0, 0, 30_000));
        let result = fetch_with_exponential_backoff(
            &test_client(),
            &server.url,
            &test_settings(0),
            None,
            &semaphore,
            &throttle,
        )
        .await;
        assert!(result.is_err());
        assert_eq!(semaphore.available_permits(), 1);
    }
}
