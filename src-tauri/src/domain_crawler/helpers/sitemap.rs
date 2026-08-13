use flate2::read::GzDecoder;
use futures::StreamExt;
use quick_xml::{events::Event, escape::unescape, name::QName, Reader};
use reqwest::Client;
use std::{
    collections::{HashSet, VecDeque},
    io::Read,
};
use url::Url;

// Sitemap protocol limits are 50,000 locations and 50 MB uncompressed per
// document. Global bounds keep a malicious or cyclic index tree from consuming
// unbounded memory while still allowing large, real-world sites.
const MAX_LOCATIONS_PER_SITEMAP: usize = 50_000;
const MAX_SITEMAP_BYTES: usize = 50 * 1024 * 1024;
const MAX_SITEMAPS: usize = 10_000;
const MAX_SITEMAP_DEPTH: usize = 20;
const MAX_SITEMAP_REDIRECTS: usize = 10;
const MAX_DISCOVERED_URLS: usize = 1_000_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SitemapKind {
    UrlSet,
    Index,
}

#[derive(Debug, Default, Eq, PartialEq)]
struct ParsedSitemap {
    urls: Vec<String>,
    nested_sitemaps: Vec<String>,
}

pub async fn extract_urls_from_sitemaps(
    base_url: &Url,
    client: &Client,
    declared_sitemaps: &[String],
) -> HashSet<String> {
    let mut discovered_urls = HashSet::new();
    let mut seen_sitemaps = HashSet::new();
    let mut processed_sitemaps = HashSet::new();
    let mut queue = VecDeque::new();

    // robots.txt was fetched once by the crawl orchestrator with the configured
    // request UA. Reuse those declarations instead of fetching robots again.
    for sitemap_url in declared_sitemaps {
        if let Some(url) = resolve_http_url(base_url, sitemap_url) {
            enqueue_sitemap(&mut queue, &mut seen_sitemaps, url, 0);
        }
    }

    // Try the conventional root locations as fallbacks. A set prevents a robots
    // declaration for either default from causing a duplicate request.
    for path in ["/sitemap.xml", "/sitemap_index.xml"] {
        if let Ok(url) = base_url.join(path) {
            enqueue_sitemap(&mut queue, &mut seen_sitemaps, url, 0);
        }
    }

    while let Some((current_sitemap, depth)) = queue.pop_front() {
        if !processed_sitemaps.insert(current_sitemap.to_string()) {
            continue;
        }
        if discovered_urls.len() >= MAX_DISCOVERED_URLS {
            tracing::warn!(
                "Sitemap discovery stopped at the global {} URL safety limit",
                MAX_DISCOVERED_URLS
            );
            break;
        }

        match fetch_sitemap(&current_sitemap, client).await {
            Ok((content, effective_sitemap_url)) => {
                // If the sitemap redirected, record its final identity too so a
                // nested index cannot make us fetch the same document again.
                seen_sitemaps.insert(effective_sitemap_url.to_string());
                processed_sitemaps.insert(effective_sitemap_url.to_string());
                match parse_sitemap_content(&content) {
                    Ok(parsed) => {
                        for location in parsed.urls {
                            if discovered_urls.len() >= MAX_DISCOVERED_URLS {
                                break;
                            }
                            if let Some(mut page_url) =
                                resolve_http_url(&effective_sitemap_url, &location)
                            {
                                page_url.set_fragment(None);
                                discovered_urls.insert(page_url.to_string());
                            }
                        }

                        if depth < MAX_SITEMAP_DEPTH {
                            for location in parsed.nested_sitemaps {
                                if let Some(url) =
                                    resolve_http_url(&effective_sitemap_url, &location)
                                {
                                    enqueue_sitemap(
                                        &mut queue,
                                        &mut seen_sitemaps,
                                        url,
                                        depth + 1,
                                    );
                                }
                            }
                        } else if !parsed.nested_sitemaps.is_empty() {
                            tracing::warn!(
                                "Sitemap nesting stopped at depth {} for {}",
                                MAX_SITEMAP_DEPTH,
                                effective_sitemap_url
                            );
                        }
                    }
                    Err(error) => tracing::warn!(
                        "Ignoring invalid sitemap {}: {}",
                        effective_sitemap_url,
                        error
                    ),
                }
            }
            Err(error) => tracing::warn!(
                "Failed to fetch sitemap {}: {}",
                current_sitemap,
                error
            ),
        }
    }

    discovered_urls
}

fn enqueue_sitemap(
    queue: &mut VecDeque<(Url, usize)>,
    seen: &mut HashSet<String>,
    mut url: Url,
    depth: usize,
) {
    if depth > MAX_SITEMAP_DEPTH || seen.len() >= MAX_SITEMAPS {
        return;
    }
    url.set_fragment(None);
    let key = url.to_string();
    if seen.insert(key) {
        queue.push_back((url, depth));
    }
}

fn resolve_http_url(base: &Url, location: &str) -> Option<Url> {
    let location = location.trim();
    if location.is_empty() {
        return None;
    }
    let url = Url::parse(location).or_else(|_| base.join(location)).ok()?;
    matches!(url.scheme(), "http" | "https").then_some(url)
}

async fn fetch_sitemap(url: &Url, client: &Client) -> Result<(String, Url), String> {
    let mut current_url = url.clone();
    let mut redirect_chain = HashSet::new();

    for redirect_count in 0..=MAX_SITEMAP_REDIRECTS {
        if !redirect_chain.insert(current_url.to_string()) {
            return Err(format!("redirect loop at {}", current_url));
        }

        let response = client
            .get(current_url.clone())
            .send()
            .await
            .map_err(|error| error.to_string())?;

        if response.status().is_redirection() {
            if redirect_count == MAX_SITEMAP_REDIRECTS {
                return Err(format!(
                    "redirect limit ({}) exceeded",
                    MAX_SITEMAP_REDIRECTS
                ));
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| format!("HTTP {} without Location", response.status()))?;
            current_url = resolve_http_url(&current_url, location)
                .ok_or_else(|| format!("invalid sitemap redirect Location '{}'", location))?;
            continue;
        }

        if !response.status().is_success() {
            return Err(format!("HTTP error: {}", response.status()));
        }

        let mut encoded = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| error.to_string())?;
            if encoded.len().saturating_add(chunk.len()) > MAX_SITEMAP_BYTES {
                return Err(format!(
                    "response exceeds the {} byte safety limit",
                    MAX_SITEMAP_BYTES
                ));
            }
            encoded.extend_from_slice(&chunk);
        }

        return decode_sitemap_body(&encoded).map(|content| (content, current_url));
    }

    Err("sitemap redirect limit exceeded".to_string())
}

fn decode_sitemap_body(encoded: &[u8]) -> Result<String, String> {
    let bytes = if encoded.starts_with(&[0x1f, 0x8b]) {
        // Many .xml.gz endpoints serve a gzip *file* without Content-Encoding,
        // so reqwest cannot transparently decode it. Detect the file signature.
        let decoder = GzDecoder::new(encoded);
        let mut limited = decoder.take((MAX_SITEMAP_BYTES + 1) as u64);
        let mut decoded = Vec::new();
        limited
            .read_to_end(&mut decoded)
            .map_err(|error| format!("invalid gzip sitemap: {}", error))?;
        if decoded.len() > MAX_SITEMAP_BYTES {
            return Err(format!(
                "decompressed sitemap exceeds the {} byte safety limit",
                MAX_SITEMAP_BYTES
            ));
        }
        decoded
    } else {
        encoded.to_vec()
    };

    let text = String::from_utf8(bytes)
        .map_err(|_| "sitemap is not valid UTF-8 XML".to_string())?;
    Ok(text.trim_start_matches('\u{feff}').to_string())
}

fn parse_sitemap_content(content: &str) -> Result<ParsedSitemap, String> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(true);

    let mut root_kind = None;
    let mut stack: Vec<Vec<u8>> = Vec::new();
    let mut parsed = ParsedSitemap::default();

    loop {
        match reader.read_event().map_err(|error| error.to_string())? {
            Event::Start(start) => {
                let local_name = start.local_name().as_ref().to_ascii_lowercase();
                if root_kind.is_none() {
                    root_kind = match local_name.as_slice() {
                        b"urlset" => Some(SitemapKind::UrlSet),
                        b"sitemapindex" => Some(SitemapKind::Index),
                        _ => {
                            return Err(format!(
                                "unexpected XML root element '{}'",
                                String::from_utf8_lossy(&local_name)
                            ));
                        }
                    };
                }

                let expected_parent = match root_kind {
                    Some(SitemapKind::UrlSet) => b"url".as_slice(),
                    Some(SitemapKind::Index) => b"sitemap".as_slice(),
                    None => unreachable!(),
                };

                if local_name == b"loc"
                    && stack.last().is_some_and(|parent| parent.as_slice() == expected_parent)
                {
                    let end_name = start.name().as_ref().to_vec();
                    let raw = reader
                        .read_text(QName(&end_name))
                        .map_err(|error| error.to_string())?;
                    let location = decode_xml_text(raw.as_ref())?;
                    if !location.is_empty() {
                        let locations = match root_kind {
                            Some(SitemapKind::UrlSet) => &mut parsed.urls,
                            Some(SitemapKind::Index) => &mut parsed.nested_sitemaps,
                            None => unreachable!(),
                        };
                        if locations.len() < MAX_LOCATIONS_PER_SITEMAP {
                            locations.push(location);
                        }
                    }
                } else {
                    stack.push(local_name);
                }
            }
            Event::End(_) => {
                stack.pop();
            }
            Event::Eof => break,
            _ => {}
        }
    }

    root_kind
        .map(|_| parsed)
        .ok_or_else(|| "empty sitemap XML".to_string())
}

fn decode_xml_text(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    if let Some(cdata) = raw
        .strip_prefix("<![CDATA[")
        .and_then(|value| value.strip_suffix("]]>"))
    {
        // CDATA is literal character data. In particular, a query-string `&`
        // is not an entity opener and must not be passed through XML unescape.
        return Ok(cdata.trim().to_string());
    }
    unescape(raw)
        .map(|value| value.trim().to_string())
        .map_err(|error| format!("invalid escaped sitemap location: {}", error))
}

#[cfg(test)]
mod tests {
    use super::{decode_sitemap_body, parse_sitemap_content};
    use flate2::{write::GzEncoder, Compression};
    use std::io::Write;

    #[test]
    fn parses_namespaced_urlset_and_unescapes_locations() {
        let xml = r#"<?xml version="1.0"?>
            <sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9">
              <sm:url><sm:loc>https://example.com/a?x=1&amp;y=2</sm:loc></sm:url>
              <sm:url><sm:loc><![CDATA[https://example.com/b?q=a&b]]></sm:loc></sm:url>
            </sm:urlset>"#;
        let parsed = parse_sitemap_content(xml).unwrap();
        assert_eq!(
            parsed.urls,
            ["https://example.com/a?x=1&y=2", "https://example.com/b?q=a&b"]
        );
        assert!(parsed.nested_sitemaps.is_empty());
    }

    #[test]
    fn parses_case_insensitive_namespaced_sitemap_index() {
        let xml = r#"<SM:SITEMAPINDEX xmlns:SM="urn:test">
            <SM:SITEMAP><SM:LOC>https://example.com/one.xml</SM:LOC></SM:SITEMAP>
            <SM:SITEMAP><SM:LOC>../two.xml.gz</SM:LOC></SM:SITEMAP>
          </SM:SITEMAPINDEX>"#;
        let parsed = parse_sitemap_content(xml).unwrap();
        assert!(parsed.urls.is_empty());
        assert_eq!(
            parsed.nested_sitemaps,
            ["https://example.com/one.xml", "../two.xml.gz"]
        );
    }

    #[test]
    fn xml_urls_in_a_urlset_remain_page_urls() {
        let parsed = parse_sitemap_content(
            "<urlset><url><loc>https://example.com/feed.xml</loc></url></urlset>",
        )
        .unwrap();
        assert_eq!(parsed.urls, ["https://example.com/feed.xml"]);
        assert!(parsed.nested_sitemaps.is_empty());
    }

    #[test]
    fn rejects_html_instead_of_guessing_from_markup() {
        assert!(parse_sitemap_content("<html><body>not a sitemap</body></html>").is_err());
    }

    #[test]
    fn decompresses_a_gzip_sitemap_file() {
        let xml = "<urlset><url><loc>https://example.com/</loc></url></urlset>";
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(xml.as_bytes()).unwrap();
        let compressed = encoder.finish().unwrap();
        assert_eq!(decode_sitemap_body(&compressed).unwrap(), xml);
    }
}
