//! Fetches status code, size and content type for the assets a crawl found.
//!
//! The crawler discovers images, scripts and stylesheets by reading them out of
//! each page's HTML, but never requests them — so the Internal view could show
//! their addresses and nothing else. Screaming Frog requests every one, which
//! is how its Internal tab reports a 403 on a banner image or a 500KB script.
//!
//! HEAD is tried first because it is cheap; servers that reject HEAD (405/501,
//! and a surprising number of CDNs) fall back to a ranged GET asking for the
//! first byte only, which still yields the status and usually a size.

use futures::{stream, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetStatus {
    pub url: String,
    /// 0 when the request never got a response at all
    pub status: u16,
    /// Content-Length when the server reports one, else null
    pub size_bytes: Option<u64>,
    pub content_type: Option<String>,
    /// Last-Modified header, which Screaming Frog reports for assets too.
    pub last_modified: Option<String>,
    /// When this asset was checked, so its row carries a Crawl Timestamp
    /// rather than a blank the way a crawled page does not.
    pub checked_at: Option<String>,
    pub error: Option<String>,
}

const CONCURRENCY: usize = 10;
const TIMEOUT_SECS: u64 = 15;

async fn check_one(client: &Client, url: String) -> AssetStatus {
    let head = client.head(&url).send().await;

    let response = match head {
        // Some servers answer HEAD with "not allowed" rather than the real
        // status; a ranged GET gets the truth without downloading the file.
        Ok(r) if r.status().as_u16() == 405 || r.status().as_u16() == 501 => {
            client.get(&url).header("Range", "bytes=0-0").send().await
        }
        other => other,
    };

    match response {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let headers = resp.headers();

            let content_type = headers
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            // A ranged response reports the slice length in Content-Length, so
            // prefer Content-Range's total when it is present.
            let size_bytes = headers
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.rsplit('/').next().map(|s| s.to_string()))
                .and_then(|total| total.parse::<u64>().ok())
                .or_else(|| {
                    headers
                        .get(reqwest::header::CONTENT_LENGTH)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.parse::<u64>().ok())
                });

            let last_modified = headers
                .get(reqwest::header::LAST_MODIFIED)
                .and_then(|v| v.to_str().ok())
                .map(|v| v.to_string());

            AssetStatus {
                url,
                status,
                size_bytes,
                content_type,
                last_modified,
                checked_at: Some(
                    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                ),
                error: None,
            }
        }
        Err(e) => AssetStatus {
            url,
            status: 0,
            size_bytes: None,
            content_type: None,
            last_modified: None,
            checked_at: Some(chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()),
            error: Some(if e.is_timeout() {
                "timeout".to_string()
            } else if e.is_connect() {
                "connection failed".to_string()
            } else {
                e.to_string()
            }),
        },
    }
}

pub async fn check_assets(urls: Vec<String>) -> Vec<AssetStatus> {
    if urls.is_empty() {
        return Vec::new();
    }

    let client = match Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .user_agent(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
             (KHTML, like Gecko) OnwebsSEO/1.0 Safari/537.36",
        )
        // Follow redirects so an asset behind a 301 reports its final status,
        // which is what the user cares about for a resource.
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to build asset checker client: {}", e);
            return Vec::new();
        }
    };

    stream::iter(urls)
        .map(|u| {
            let client = client.clone();
            async move { check_one(&client, u).await }
        })
        .buffer_unordered(CONCURRENCY)
        .collect()
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn empty_input_returns_empty() {
        assert!(check_assets(Vec::new()).await.is_empty());
    }

    #[tokio::test]
    async fn unreachable_host_is_reported_not_panicked() {
        // A host that cannot resolve must come back as status 0 with an error,
        // never as a panic or a dropped entry.
        let out = check_assets(vec![
            "http://this-host-does-not-exist.invalid/a.png".to_string()
        ])
        .await;
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].status, 0);
        assert!(out[0].error.is_some());
    }
}
