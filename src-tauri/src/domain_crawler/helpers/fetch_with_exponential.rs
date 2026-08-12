use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;
use reqwest::Client;
use tokio::time::{sleep, Instant};

use crate::settings::settings::Settings;

// Fetch URL with exponential backoff
/// `control` is the shared crawl-control flag: 0 run, 1 pause, 2 stop.
/// It is checked before every attempt and during every backoff sleep so a
/// Stop takes effect immediately instead of after the retry budget expires —
/// on a slow host that was the difference between stopping now and stopping
/// five minutes from now.
pub async fn fetch_with_exponential_backoff(
    client: &Client,
    url: &str,
    settings: &Settings,
    control: Option<&Arc<AtomicU8>>,
) -> Result<Option<(reqwest::Response, f64)>, reqwest::Error> {
    let stopped = |c: Option<&Arc<AtomicU8>>| {
        c.map(|f| f.load(Ordering::Relaxed) == 2).unwrap_or(false)
    };

    let mut attempt = 0;
    loop {
        // `Ok(None)` means "the user stopped the crawl", which is not an
        // error — the caller just unwinds without recording a failure.
        if stopped(control) {
            return Ok(None);
        }

        let start = Instant::now();
        
        let request_builder = client.get(url);

        match request_builder.send().await {
            Ok(response) => {
                let duration = start.elapsed().as_secs_f64();
                let status = response.status();

                if status == reqwest::StatusCode::TOO_MANY_REQUESTS 
                    || status == reqwest::StatusCode::SERVICE_UNAVAILABLE 
                    || status == reqwest::StatusCode::FORBIDDEN {
                    if attempt >= settings.max_retries {
                        return Ok(Some((response, duration)));
                    }

                    // Respect Retry-After header if present
                    let retry_after = response.headers()
                        .get(reqwest::header::RETRY_AFTER)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|s| {
                            // Can be either seconds or a HTTP date
                            s.parse::<u64>().ok().map(|secs| Duration::from_secs(secs))
                            // Handle date parsing if needed, but seconds is most common for 429
                        });

                    let delay = if let Some(ra_duration) = retry_after {
                        // Respect server's Retry-After but enforce a floor
                        ra_duration.max(Duration::from_secs(2))
                    } else {
                        // Exponential backoff: base * 2^attempt, with a minimum floor of 2s
                        // Use saturating_mul to avoid overflow
                        let effective_base = settings.base_delay.max(1000); // At least 1s base
                        let backoff = effective_base.saturating_mul(2u64.saturating_pow(attempt as u32));
                        let capped = std::cmp::min(settings.max_delay.max(10000), backoff);
                        Duration::from_millis(capped.max(2000)) // Never less than 2s for 429
                    };

                    tracing::warn!("Rate limited ({}). Retrying in {:?} (Attempt {})", status, delay, attempt + 1);
                    // Sleep in slices so a Stop is noticed during a long backoff.
                    let mut left = delay;
                    while left > Duration::ZERO {
                        if stopped(control) {
                            break;
                        }
                        let slice = left.min(Duration::from_millis(250));
                        sleep(slice).await;
                        left = left.saturating_sub(slice);
                    }
                    attempt += 1;
                    continue;
                }
                return Ok(Some((response, duration)));
            }
            Err(e) => {
                if attempt >= settings.max_retries {
                    return Err(e);
                }
                let delay = Duration::from_millis(std::cmp::min(
                    settings.max_delay,
                    settings.base_delay * 2u64.pow(attempt as u32),
                ));
                tracing::warn!("Request error: {}. Retrying in {:?} (Attempt {})", e, delay, attempt + 1);
                // Sleep in slices so a Stop is noticed during a long backoff.
                    let mut left = delay;
                    while left > Duration::ZERO {
                        if stopped(control) {
                            break;
                        }
                        let slice = left.min(Duration::from_millis(250));
                        sleep(slice).await;
                        left = left.saturating_sub(slice);
                    }
                attempt += 1;
            }
        }
    }
}
