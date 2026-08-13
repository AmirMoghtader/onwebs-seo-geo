use url::Url;

/// Return a standards-safe canonical spelling of an absolute URL for crawl
/// de-duplication.
///
/// `url::Url` already applies the URL Standard's host casing, default-port and
/// dot-segment rules while parsing. We deliberately do *not* rewrite the query
/// string or trailing slash: parameter order, duplicate parameters, escaping,
/// and `/path` versus `/path/` can all be meaningful to an origin server.
pub fn normalize_url(url_str: &str) -> String {
    let Ok(mut url) = Url::parse(url_str) else {
        // Lower-casing an unparseable value can silently change a case-sensitive
        // path or query. Leave it untouched so callers can reject it explicitly.
        return url_str.to_string();
    };

    // Fragments are never sent in an HTTP request and therefore cannot identify
    // a different crawl resource.
    url.set_fragment(None);

    // The URL crate currently removes default ports during parsing. Keep this
    // explicit so the de-duplication contract remains clear if parser behaviour
    // changes or a URL was assembled programmatically before being serialized.
    let is_default_port = matches!(
        (url.scheme(), url.port()),
        ("http", Some(80)) | ("https", Some(443))
    );
    if is_default_port {
        let _ = url.set_port(None);
    }

    url.to_string()
}

#[cfg(test)]
mod tests {
    use super::normalize_url;

    #[test]
    fn removes_fragments_default_ports_and_dot_segments() {
        assert_eq!(
            normalize_url("HTTP://Example.COM:80/a/./b/../c?q=1#section"),
            "http://example.com/a/c?q=1"
        );
        assert_eq!(
            normalize_url("https://Example.COM:443/a#top"),
            "https://example.com/a"
        );
    }

    #[test]
    fn preserves_trailing_slash_and_repeated_path_slashes() {
        assert_eq!(
            normalize_url("https://example.com/path"),
            "https://example.com/path"
        );
        assert_eq!(
            normalize_url("https://example.com/path/"),
            "https://example.com/path/"
        );
        assert_eq!(
            normalize_url("https://example.com/a//b/"),
            "https://example.com/a//b/"
        );
    }

    #[test]
    fn preserves_query_order_duplicates_encoding_and_tracking_parameters() {
        assert_eq!(
            normalize_url(
                "https://example.com/P?b=two%20words&utm_source=News&a=1&a=2&sig=A%2Fb"
            ),
            "https://example.com/P?b=two%20words&utm_source=News&a=1&a=2&sig=A%2Fb"
        );
    }

    #[test]
    fn does_not_mutate_an_invalid_url() {
        assert_eq!(
            normalize_url("NOT A URL/CaseSensitive?X=Y"),
            "NOT A URL/CaseSensitive?X=Y"
        );
    }
}
