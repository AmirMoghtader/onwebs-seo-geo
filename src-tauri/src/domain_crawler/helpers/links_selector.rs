use once_cell::sync::Lazy;
use scraper::{Html, Selector};
use url::Url;
use std::collections::HashSet;

static LINK_SELECTOR: Lazy<Selector> = Lazy::new(|| Selector::parse("a[href]").unwrap());

/// Extracts and normalizes links from HTML
pub fn extract_links(document: &Html, resolve_url: &Url, scope_url: &Url) -> HashSet<Url> {
    let mut unique_urls = HashSet::new();

    for element in document.select(&LINK_SELECTOR) {
        if let Some(href) = element.value().attr("href") {
            if let Some(url) = process_link(resolve_url, scope_url, href) {
                unique_urls.insert(url);
            }
        }
    }

    unique_urls
}


/// Process a single link
fn process_link(resolve_url: &Url, scope_url: &Url, href: &str) -> Option<Url> {
    // Skip problematic hrefs early
    if href.is_empty() || href.starts_with('#') || href.starts_with("javascript:") {
        return None;
    }

    // Build URL using resolve_url (current page)
    let url = build_full_url(resolve_url, href).ok()?;

    // Validate using scope_url (root domain)
    validate_and_normalize_url(scope_url, &url)
}

/// Build URL with better relative path handling
fn build_full_url(base_url: &Url, href: &str) -> Result<Url, url::ParseError> {
    // Standardize URL joining
    base_url.join(href)
}

/// Validate and normalize with PROPER domain checking
fn validate_and_normalize_url(base_url: &Url, url: &Url) -> Option<Url> {
    // Must be http/https
    if url.scheme() != "http" && url.scheme() != "https" {
        return None;
    }

    // Must have domain
    let base_domain = base_url.domain()?;
    let url_domain = url.domain()?;

    // SECURE domain check (not just ends_with!)
    if !is_same_or_subdomain(url_domain, base_domain) {
        return None;
    }

    // Normalize
    let mut normalized = url.clone();

    // Fragments are client-side locations, but query bytes and ordering are
    // part of the crawl identity and must remain untouched.
    normalized.set_fragment(None);

    Some(normalized)
}

/// Improved domain checking: allows same domain, subdomains, and the naked domain
pub fn is_same_or_subdomain(url_domain: &str, base_domain: &str) -> bool {
    // url_domain and base_domain are already lowercase from Url::domain()
    // so we don't need to allocate new strings here


    if url_domain == base_domain {
        return true;
    }

    // Strip 'www.' to get the root-like domain
    let url_root = url_domain.strip_prefix("www.").unwrap_or(&url_domain);
    let base_root = base_domain.strip_prefix("www.").unwrap_or(&base_domain);

    if url_root == base_root {
        return true;
    }

    // Allow subdomains of either root
    // e.g., if base is 'example.com', allow 'shop.example.com'
    // e.g., if base is 'www.example.com', allow 'shop.example.com'
    // Check for dot before the root to ensure it's a true subdomain
    // e.g. "shop.example.com" ends with ".example.com"
    (url_domain.ends_with(base_root) && url_domain.len() > base_root.len() && url_domain.as_bytes()[url_domain.len() - base_root.len() - 1] == b'.')
        || (base_domain.ends_with(url_root) && base_domain.len() > url_root.len() && base_domain.as_bytes()[base_domain.len() - url_root.len() - 1] == b'.')
}

#[cfg(test)]
mod tests {
    use super::process_link;
    use url::Url;

    fn process(href: &str) -> Url {
        let page = Url::parse("https://example.com/dir/page").unwrap();
        let scope = Url::parse("https://example.com/").unwrap();
        process_link(&page, &scope, href).unwrap()
    }

    #[test]
    fn preserves_trailing_slash_as_a_distinct_url() {
        let without = process("/path");
        let with = process("/path/");
        assert_eq!(without.as_str(), "https://example.com/path");
        assert_eq!(with.as_str(), "https://example.com/path/");
        assert_ne!(without, with);
    }

    #[test]
    fn preserves_repeated_path_slashes() {
        assert_eq!(process("/a//b").as_str(), "https://example.com/a//b");
    }

    #[test]
    fn preserves_query_order_and_only_removes_fragment() {
        let first = process("/search?b=2&a=1#section");
        let second = process("/search?a=1&b=2#other");
        assert_eq!(first.as_str(), "https://example.com/search?b=2&a=1");
        assert_eq!(second.as_str(), "https://example.com/search?a=1&b=2");
        assert_ne!(first, second);
    }
}
