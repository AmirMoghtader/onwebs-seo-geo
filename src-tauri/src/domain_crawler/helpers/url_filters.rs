//! Include / Exclude URL filtering, matching Screaming Frog's Configuration
//! menu.
//!
//! Both lists are regex, one pattern per line, tested against the full URL:
//!
//! * **Exclude** — a URL matching any pattern is never crawled. This is the one
//!   people reach for: keep the crawler out of `/cart/`, `?sessionid=`, an
//!   endless calendar.
//! * **Include** — when non-empty, a URL must match at least one pattern to be
//!   crawled, which scopes a crawl to a single section.
//!
//! Exclude wins over Include, same as Screaming Frog, so you can include a
//! whole section and still carve pieces out of it.
//!
//! Invalid regex is skipped rather than failing the crawl: a half-typed pattern
//! in the config box should not take the whole run down.

use regex::Regex;

#[derive(Debug, Clone, Default)]
pub struct UrlFilters {
    include: Vec<Regex>,
    exclude: Vec<Regex>,
}

fn compile(patterns: &[String], label: &str) -> Vec<Regex> {
    patterns
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .filter_map(|p| match Regex::new(p) {
            Ok(re) => Some(re),
            Err(e) => {
                tracing::warn!("Ignoring invalid {} pattern {:?}: {}", label, p, e);
                None
            }
        })
        .collect()
}

impl UrlFilters {
    pub fn new(include: &[String], exclude: &[String]) -> Self {
        Self {
            include: compile(include, "include"),
            exclude: compile(exclude, "exclude"),
        }
    }

    /// True when nothing is configured, so callers can skip the check entirely.
    pub fn is_empty(&self) -> bool {
        self.include.is_empty() && self.exclude.is_empty()
    }

    pub fn allows(&self, url: &str) -> bool {
        if self.exclude.iter().any(|re| re.is_match(url)) {
            return false;
        }
        if self.include.is_empty() {
            return true;
        }
        self.include.iter().any(|re| re.is_match(url))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_filters_allow_everything() {
        let f = UrlFilters::new(&[], &[]);
        assert!(f.is_empty());
        assert!(f.allows("https://example.com/anything"));
    }

    #[test]
    fn exclude_blocks_matching_urls() {
        let f = UrlFilters::new(&[], &[r"/cart/".to_string()]);
        assert!(!f.allows("https://example.com/cart/checkout"));
        assert!(f.allows("https://example.com/blog/post"));
    }

    #[test]
    fn include_scopes_the_crawl() {
        let f = UrlFilters::new(&[r"/blog/".to_string()], &[]);
        assert!(f.allows("https://example.com/blog/post"));
        assert!(!f.allows("https://example.com/shop/item"));
    }

    #[test]
    fn exclude_wins_over_include() {
        let f = UrlFilters::new(&[r"/blog/".to_string()], &[r"/blog/draft".to_string()]);
        assert!(f.allows("https://example.com/blog/live"));
        assert!(!f.allows("https://example.com/blog/draft-1"));
    }

    #[test]
    fn invalid_pattern_is_skipped_not_fatal() {
        // "[" is not a valid regex; the valid sibling must still apply.
        let f = UrlFilters::new(&[], &["[".to_string(), r"/cart/".to_string()]);
        assert!(!f.allows("https://example.com/cart/x"));
        assert!(f.allows("https://example.com/ok"));
    }
}

/// Compiled filters, cached by their pattern text.
///
/// `process_url` runs once per URL and only has `&Settings` to work from, so
/// without this it would recompile every regex on every page. The key is the
/// pattern list itself, which means changing the config in the UI produces a
/// new entry rather than serving a stale filter.
pub fn cached(include: &[String], exclude: &[String]) -> std::sync::Arc<UrlFilters> {
    use once_cell::sync::Lazy;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    static CACHE: Lazy<Mutex<HashMap<String, Arc<UrlFilters>>>> =
        Lazy::new(|| Mutex::new(HashMap::new()));

    let key = format!("{}\u{1}{}", include.join("\u{2}"), exclude.join("\u{2}"));

    let mut guard = match CACHE.lock() {
        Ok(g) => g,
        // A poisoned mutex here should not stop a crawl; fall back to compiling.
        Err(_) => return Arc::new(UrlFilters::new(include, exclude)),
    };

    if let Some(hit) = guard.get(&key) {
        return hit.clone();
    }

    let built = Arc::new(UrlFilters::new(include, exclude));
    guard.insert(key, built.clone());
    built
}
