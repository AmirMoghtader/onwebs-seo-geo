use futures::stream::{self, StreamExt};
use once_cell::sync::Lazy;
use reqwest::{header, Client, Response, StatusCode};
use scraper::{Html, Selector};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::{OnceCell, Semaphore};
use tokio::time::{timeout, Duration};
use url::Url;

/// Maximum number of image occurrences a single page resolves concurrently.
/// The checker also owns a crawl-wide semaphore, so concurrency stays bounded
/// across all pages rather than multiplying by the page worker count.
const MAX_CONCURRENT_IMAGE_FETCHES_PER_PAGE: usize = 10;
const IMAGE_METADATA_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_IMAGE_METADATA_CACHE_CAPACITY: usize = 50_000;
pub const DEFAULT_IMAGE_METADATA_CACHE_CAPACITY: usize = 20_000;

static IMG_SELECTOR: Lazy<Selector> =
    Lazy::new(|| Selector::parse("img").expect("Failed to parse img selector"));

/// Response facts shared by every occurrence of one image URL. Page-specific
/// facts such as alt text and HTML width/height attributes never enter this
/// cache and are retained separately for every occurrence.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ImageMetadata {
    pub content_length: u64,
    pub content_type: String,
    pub status_code: u16,
    pub error: Option<String>,
}

#[derive(Default)]
struct ImageMetadataCacheInner {
    entries: HashMap<String, Arc<OnceCell<ImageMetadata>>>,
    insertion_order: VecDeque<String>,
}

/// Crawl-wide, bounded, single-flight image metadata checker.
///
/// Cache keys preserve the URL query exactly but omit fragments because HTTP
/// fragments are not sent to the server. Only response metadata is cached.
pub struct ImageMetadataChecker {
    client: Client,
    request_slots: Arc<Semaphore>,
    capacity: usize,
    cache: StdMutex<ImageMetadataCacheInner>,
}

impl ImageMetadataChecker {
    pub fn new(client: Client, request_slots: Arc<Semaphore>, capacity: usize) -> Self {
        Self {
            client,
            request_slots,
            capacity: capacity.clamp(1, MAX_IMAGE_METADATA_CACHE_CAPACITY),
            cache: StdMutex::new(ImageMetadataCacheInner::default()),
        }
    }

    /// Resolve metadata once for the fragment-insensitive, query-preserving URL
    /// key. Concurrent callers for the same key await the same initialization.
    pub async fn metadata_for(&self, url: &Url) -> ImageMetadata {
        // Inline images carry their bytes in the URL itself — there is nothing
        // to request. A single Persian page produced 324 of these `data:` SVG
        // lookups, every one of them a guaranteed failure.
        if !matches!(url.scheme(), "http" | "https") {
            return ImageMetadata::default();
        }

        let (request_url, key) = image_metadata_cache_key(url);
        let cell = self.cell_for(key);
        cell.get_or_init(|| async {
            let metadata = self.fetch_uncached(&request_url).await;
            if let Some(error) = metadata.error.as_deref() {
                tracing::debug!("Image metadata check for {}: {}", request_url, error);
            }
            metadata
        })
        .await
        .clone()
    }

    fn cell_for(&self, key: String) -> Arc<OnceCell<ImageMetadata>> {
        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(cell) = cache.entries.get(&key) {
            return cell.clone();
        }

        while cache.entries.len() >= self.capacity {
            let Some(oldest) = cache.insertion_order.pop_front() else {
                break;
            };
            cache.entries.remove(&oldest);
        }

        let cell = Arc::new(OnceCell::new());
        cache.entries.insert(key.clone(), cell.clone());
        cache.insertion_order.push_back(key);
        cell
    }

    async fn fetch_uncached(&self, url: &Url) -> ImageMetadata {
        let _permit = match self.request_slots.acquire().await {
            Ok(permit) => permit,
            Err(_) => {
                return ImageMetadata {
                    error: Some("Image metadata request semaphore closed".to_string()),
                    ..ImageMetadata::default()
                };
            }
        };

        let head_response = match timeout(
            IMAGE_METADATA_TIMEOUT,
            self.client.head(url.clone()).send(),
        )
        .await
        {
            Ok(Ok(response)) => response,
            Ok(Err(error)) => {
                return ImageMetadata {
                    error: Some(format!("HEAD request failed: {}", error)),
                    ..ImageMetadata::default()
                };
            }
            Err(_) => {
                return ImageMetadata {
                    error: Some("HEAD request timed out".to_string()),
                    ..ImageMetadata::default()
                };
            }
        };

        if !requires_get_fallback(head_response.status()) {
            return metadata_from_response(&head_response);
        }

        // Some CDNs reject HEAD while serving GET normally. send() resolves
        // once response headers arrive; inspect those headers and drop Response
        // without consuming its body. A normal GET preserves the URL's real
        // status instead of manufacturing a 206 via a Range request.
        let head_metadata = metadata_from_response(&head_response);
        match timeout(
            IMAGE_METADATA_TIMEOUT,
            self.client.get(url.clone()).send(),
        )
        .await
        {
            Ok(Ok(response)) => metadata_from_response(&response),
            Ok(Err(error)) => ImageMetadata {
                error: Some(format!(
                    "GET metadata fallback failed after HTTP {}: {}",
                    head_metadata.status_code, error
                )),
                ..head_metadata
            },
            Err(_) => ImageMetadata {
                error: Some(format!(
                    "GET metadata fallback timed out after HTTP {}",
                    head_metadata.status_code
                )),
                ..head_metadata
            },
        }
    }

    #[cfg(test)]
    fn cached_entry_count(&self) -> usize {
        self.cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .entries
            .len()
    }
}

fn image_metadata_cache_key(url: &Url) -> (Url, String) {
    let mut request_url = url.clone();
    request_url.set_fragment(None);
    let key = request_url.to_string();
    (request_url, key)
}

fn requires_get_fallback(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::FORBIDDEN | StatusCode::METHOD_NOT_ALLOWED | StatusCode::NOT_IMPLEMENTED
    )
}

fn metadata_from_response(response: &Response) -> ImageMetadata {
    let status = response.status();
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let content_length = total_length_from_headers(response);
    let is_image = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .starts_with("image/");
    let error = if !status.is_success() {
        Some(format!("HTTP {}", status.as_u16()))
    } else if !is_image {
        Some(format!(
            "Non-image content type: {}",
            if content_type.is_empty() {
                "unknown"
            } else {
                content_type.as_str()
            }
        ))
    } else {
        None
    };

    ImageMetadata {
        content_length,
        content_type,
        status_code: status.as_u16(),
        error,
    }
}

fn total_length_from_headers(response: &Response) -> u64 {
    // Prefer a complete size from Content-Range when a server supplies one;
    // otherwise use the ordinary Content-Length response metadata.
    response
        .headers()
        .get(header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit_once('/'))
        .and_then(|(_, total)| (total != "*").then_some(total))
        .and_then(|total| total.parse::<u64>().ok())
        .or_else(|| {
            response
                .headers()
                .get(header::CONTENT_LENGTH)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
        })
        .unwrap_or(0)
}

/// Extract image URL plus occurrence-specific alt and HTML size attributes.
pub fn extract_image_urls_and_alts(document: &Html, base_url: &Url) -> Vec<(Url, String, bool)> {
    document
        .select(&IMG_SELECTOR)
        .filter_map(|element| {
            let src = element
                .value()
                .attr("src")
                .or_else(|| element.value().attr("data-src"))?;

            let url = base_url.join(src).ok()?;
            // An inline `data:` image is bytes, not an address. A single
            // websima.com crawl carried 628 of these placeholder SVGs into the
            // image list, where they were stored, counted as URLs found, and
            // reported as assets the crawl had discovered.
            if !matches!(url.scheme(), "http" | "https") {
                return None;
            }
            let alt = element.value().attr("alt").unwrap_or("").to_string();
            let is_size_not_specified =
                element.value().attr("width").is_none() || element.value().attr("height").is_none();

            Some((url, alt, is_size_not_specified))
        })
        .collect()
}

/// Attach shared response metadata to each image occurrence without collapsing
/// its alt text or width/height-presence flag.
pub async fn fetch_image_details(
    checker: Arc<ImageMetadataChecker>,
    image_urls_and_alts: Vec<(Url, String, bool)>,
) -> Result<Vec<(String, String, u64, String, u16, bool)>, String> {
    let results = stream::iter(image_urls_and_alts.into_iter())
        .map(|(image_url, alt, is_size_not_specified)| {
            let checker = checker.clone();
            async move {
                let url_string = image_url.to_string();
                let metadata = checker.metadata_for(&image_url).await;
                (
                    url_string,
                    alt,
                    metadata.content_length,
                    metadata.content_type,
                    metadata.status_code,
                    is_size_not_specified,
                )
            }
        })
        .buffer_unordered(MAX_CONCURRENT_IMAGE_FETCHES_PER_PAGE)
        .collect()
        .await;

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::{
        fetch_image_details, requires_get_fallback, ImageMetadata, ImageMetadataChecker,
        DEFAULT_IMAGE_METADATA_CACHE_CAPACITY,
    };
    use reqwest::{Client, StatusCode};
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::Semaphore;
    use url::Url;

    /// Inline `data:` images carry their bytes in the URL; there is no server
    /// to ask. One real crawl produced 324 such lookups, each a guaranteed
    /// failure that cost a cache slot and a log line.
    #[tokio::test]
    async fn data_uri_images_are_not_fetched() {
        let checker =
            ImageMetadataChecker::new(
                Client::new(),
                Arc::new(Semaphore::new(4)),
                DEFAULT_IMAGE_METADATA_CACHE_CAPACITY,
            );
        let inline = Url::parse("data:image/svg+xml,%3Csvg%20xmlns='x'%3E%3C/svg%3E").unwrap();
        assert_eq!(checker.metadata_for(&inline).await, ImageMetadata::default());
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

    fn image_response(length: u64) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {length}\r\nConnection: close\r\n\r\n"
        )
    }

    fn checker(client: Client, capacity: usize) -> Arc<ImageMetadataChecker> {
        Arc::new(ImageMetadataChecker::new(
            client,
            Arc::new(Semaphore::new(8)),
            capacity,
        ))
    }

    #[tokio::test]
    async fn shared_occurrences_are_single_flight_and_keep_occurrence_fields() {
        let (origin, requests, server) = test_server(vec![image_response(321)]).await;
        let checker = checker(Client::new(), 8);
        let first = Url::parse(&format!("{origin}/shared.png#one")).unwrap();
        let second = Url::parse(&format!("{origin}/shared.png#two")).unwrap();
        let mut occurrences = Vec::new();
        for index in 0..32 {
            occurrences.push((
                if index % 2 == 0 {
                    first.clone()
                } else {
                    second.clone()
                },
                format!("alt-{index}"),
                index % 3 == 0,
            ));
        }

        let rows = fetch_image_details(checker, occurrences).await.unwrap();
        server.await.unwrap();
        assert_eq!(requests.lock().unwrap().len(), 1);
        assert_eq!(rows.len(), 32);
        assert!(rows.iter().any(|row| row.1 == "alt-0" && row.5));
        assert!(rows.iter().any(|row| row.1 == "alt-1" && !row.5));
        assert!(rows
            .iter()
            .all(|row| row.2 == 321 && row.3 == "image/png" && row.4 == 200));
    }

    #[tokio::test]
    async fn cache_ignores_fragments_but_preserves_query_identity() {
        let (origin, requests, server) =
            test_server(vec![image_response(10), image_response(20)]).await;
        let checker = checker(Client::new(), 8);
        let first = Url::parse(&format!("{origin}/asset.png?v=1#one")).unwrap();
        let same_request = Url::parse(&format!("{origin}/asset.png?v=1#two")).unwrap();
        let different_query = Url::parse(&format!("{origin}/asset.png?v=2#one")).unwrap();

        assert_eq!(checker.metadata_for(&first).await.content_length, 10);
        assert_eq!(checker.metadata_for(&same_request).await.content_length, 10);
        assert_eq!(
            checker.metadata_for(&different_query).await.content_length,
            20
        );
        server.await.unwrap();
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].starts_with("HEAD /asset.png?v=1 "));
        assert!(requests[1].starts_with("HEAD /asset.png?v=2 "));
    }

    #[tokio::test]
    async fn forbidden_head_uses_plain_get_without_reading_its_body() {
        let head_forbidden = concat!(
            "HTTP/1.1 403 Forbidden\r\n",
            "Content-Length: 0\r\n",
            "Connection: close\r\n\r\n"
        )
        .to_string();
        let get_response = concat!(
            "HTTP/1.1 200 OK\r\n",
            "Content-Type: image/webp\r\n",
            "Content-Length: 4321\r\n",
            "Connection: close\r\n\r\n"
        )
        .to_string();
        let (origin, requests, server) =
            test_server(vec![head_forbidden, get_response]).await;
        let checker = checker(Client::new(), 8);
        let url = Url::parse(&format!("{origin}/protected.webp")).unwrap();

        let metadata = checker.metadata_for(&url).await;
        server.await.unwrap();
        assert_eq!(metadata.status_code, 200);
        assert_eq!(metadata.content_length, 4321);
        assert_eq!(metadata.content_type, "image/webp");
        assert_eq!(metadata.error, None);
        let requests = requests.lock().unwrap();
        assert!(requests[0].starts_with("HEAD /protected.webp "));
        assert!(requests[1].starts_with("GET /protected.webp "));
        assert!(!requests[1].to_ascii_lowercase().contains("\r\nrange:"));
        assert!(requires_get_fallback(StatusCode::FORBIDDEN));
        assert!(requires_get_fallback(StatusCode::METHOD_NOT_ALLOWED));
        assert!(requires_get_fallback(StatusCode::NOT_IMPLEMENTED));
    }

    #[tokio::test]
    async fn cache_evicts_oldest_entries_at_its_bound() {
        let (origin, requests, server) = test_server(vec![
            image_response(1),
            image_response(2),
            image_response(3),
            image_response(4),
        ])
        .await;
        let checker = checker(Client::new(), 2);
        let first = Url::parse(&format!("{origin}/one.png")).unwrap();
        let second = Url::parse(&format!("{origin}/two.png")).unwrap();
        let third = Url::parse(&format!("{origin}/three.png")).unwrap();

        assert_eq!(checker.metadata_for(&first).await.content_length, 1);
        assert_eq!(checker.metadata_for(&second).await.content_length, 2);
        assert_eq!(checker.metadata_for(&third).await.content_length, 3);
        assert_eq!(checker.cached_entry_count(), 2);
        assert_eq!(checker.metadata_for(&first).await.content_length, 4);
        assert_eq!(checker.cached_entry_count(), 2);
        server.await.unwrap();
        assert_eq!(requests.lock().unwrap().len(), 4);
    }
}
