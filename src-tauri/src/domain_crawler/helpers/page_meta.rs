//! Head-level metadata and response facts that Screaming Frog reports but we
//! were not collecting: meta keywords, meta refresh, the mobile alternate
//! link, the X-Robots-Tag and Link headers, transfer size, HTTP version,
//! Last-Modified, and a content hash for duplicate detection.
//!
//! Grouped in one module because they are all cheap reads off the same
//! document and response, and splitting them would mean re-parsing.

use once_cell::sync::Lazy;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

static KEYWORDS: Lazy<Selector> =
    Lazy::new(|| Selector::parse(r#"meta[name="keywords" i]"#).unwrap());
static REFRESH: Lazy<Selector> =
    Lazy::new(|| Selector::parse(r#"meta[http-equiv="refresh" i]"#).unwrap());
static MOBILE_ALT: Lazy<Selector> =
    Lazy::new(|| Selector::parse(r#"link[rel="alternate"][media]"#).unwrap());

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PageMeta {
    pub meta_keywords: String,
    pub meta_refresh: String,
    pub mobile_alternate: String,
    /// X-Robots-Tag response header, which overrides the meta robots tag.
    pub x_robots_tag: String,
    /// rel=next / rel=prev delivered as HTTP Link headers rather than markup.
    pub http_rel_next: String,
    pub http_rel_prev: String,
    pub last_modified: String,
    pub http_version: String,
    /// Bytes actually received over the wire (post-compression).
    pub transferred_bytes: usize,
    /// MD5 of the response body — cheap identity for exact-duplicate detection.
    pub content_hash: String,
    /// When this URL was crawled, ISO-8601.
    pub crawl_timestamp: String,
}

fn attr(document: &Html, selector: &Selector, name: &str) -> String {
    document
        .select(selector)
        .next()
        .and_then(|el| el.value().attr(name))
        .map(|v| v.trim().to_string())
        .unwrap_or_default()
}

/// Header lookup over the (name, value) pairs the crawler already collects.
/// Case-insensitive, since header names are not case-sensitive on the wire.
fn header(headers: &[(String, String)], name: &str) -> String {
    headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.trim().to_string())
        .unwrap_or_default()
}

/// Pulls `rel="next"` / `rel="prev"` out of a Link header.
/// Format: `<https://example.com/page/2>; rel="next", <...>; rel="prev"`
fn link_header_rel(headers: &[(String, String)], want: &str) -> String {
    let raw = header(headers, "link");
    if raw.is_empty() {
        return String::new();
    }
    for part in raw.split(',') {
        let part = part.trim();
        if !part.to_lowercase().contains(&format!("rel=\"{}\"", want))
            && !part.to_lowercase().contains(&format!("rel={}", want))
        {
            continue;
        }
        if let (Some(a), Some(b)) = (part.find('<'), part.find('>')) {
            if b > a {
                return part[a + 1..b].to_string();
            }
        }
    }
    String::new()
}

pub fn extract_page_meta(
    document: &Html,
    headers: &[(String, String)],
    body: &str,
    http_version: &str,
) -> PageMeta {
    // A meta refresh looks like `content="0; url=/somewhere"`; SF reports the
    // whole content value, which keeps the delay visible.
    let refresh = attr(document, &REFRESH, "content");

    PageMeta {
        meta_keywords: attr(document, &KEYWORDS, "content"),
        meta_refresh: refresh,
        mobile_alternate: attr(document, &MOBILE_ALT, "href"),
        x_robots_tag: header(headers, "x-robots-tag"),
        http_rel_next: link_header_rel(headers, "next"),
        http_rel_prev: link_header_rel(headers, "prev"),
        last_modified: header(headers, "last-modified"),
        http_version: http_version.to_string(),
        transferred_bytes: body.len(),
        content_hash: format!("{:x}", md5::compute(body.as_bytes())),
        crawl_timestamp: chrono::Local::now()
            .format("%Y-%m-%d %H:%M:%S")
            .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_keywords_refresh_and_mobile_alternate() {
        let html = Html::parse_document(
            r#"<head>
                 <meta name="keywords" content="seo, crawler">
                 <meta http-equiv="refresh" content="0; url=/new">
                 <link rel="alternate" media="only screen and (max-width: 640px)" href="https://m.example.com/">
               </head>"#,
        );
        let m = extract_page_meta(&html, &[], "", "1.1");
        assert_eq!(m.meta_keywords, "seo, crawler");
        assert_eq!(m.meta_refresh, "0; url=/new");
        assert_eq!(m.mobile_alternate, "https://m.example.com/");
    }

    #[test]
    fn parses_rel_next_and_prev_out_of_a_link_header() {
        let h = vec![(
            "link".to_string(),
            "<https://e.com/p/1>; rel=\"prev\", <https://e.com/p/3>; rel=\"next\"".to_string(),
        )];
        let m = extract_page_meta(&Html::parse_document(""), &h, "", "2");
        assert_eq!(m.http_rel_prev, "https://e.com/p/1");
        assert_eq!(m.http_rel_next, "https://e.com/p/3");
    }

    #[test]
    fn hash_is_stable_and_differs_by_content() {
        let a = extract_page_meta(&Html::parse_document(""), &[], "hello", "1.1");
        let b = extract_page_meta(&Html::parse_document(""), &[], "hello", "1.1");
        let c = extract_page_meta(&Html::parse_document(""), &[], "world", "1.1");
        assert_eq!(a.content_hash, b.content_hash);
        assert_ne!(a.content_hash, c.content_hash);
    }

    #[test]
    fn missing_values_are_empty_not_panics() {
        let m = extract_page_meta(&Html::parse_document("<html></html>"), &[], "", "1.1");
        assert!(m.meta_keywords.is_empty());
        assert!(m.x_robots_tag.is_empty());
        assert!(m.http_rel_next.is_empty());
    }
}
