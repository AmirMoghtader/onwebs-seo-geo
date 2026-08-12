//! Pagination (`rel="next"` / `rel="prev"`) and AMP (`rel="amphtml"`) links.
//!
//! Screaming Frog gives each of these its own tab. Google no longer uses
//! rel=next/prev as an indexing signal, but a broken or self-referencing
//! pagination chain still tells you the paginated series is misbuilt, and it is
//! the fastest way to spot a series that dead-ends.

use once_cell::sync::Lazy;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};

static NEXT: Lazy<Selector> =
    Lazy::new(|| Selector::parse(r#"link[rel="next"]"#).unwrap());
static PREV: Lazy<Selector> =
    Lazy::new(|| Selector::parse(r#"link[rel="prev"]"#).unwrap());
static AMP: Lazy<Selector> =
    Lazy::new(|| Selector::parse(r#"link[rel="amphtml"]"#).unwrap());

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PaginationLinks {
    pub next: Option<String>,
    pub prev: Option<String>,
    pub amphtml: Option<String>,
}

fn first_href(document: &Html, selector: &Selector) -> Option<String> {
    document
        .select(selector)
        .next()
        .and_then(|el| el.value().attr("href"))
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty())
}

pub fn select_pagination(document: &Html) -> PaginationLinks {
    PaginationLinks {
        next: first_href(document, &NEXT),
        prev: first_href(document, &PREV),
        amphtml: first_href(document, &AMP),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_next_prev_and_amp() {
        let html = Html::parse_document(
            r#"<html><head>
                 <link rel="prev" href="/page/1">
                 <link rel="next" href="/page/3">
                 <link rel="amphtml" href="/page/2/amp">
               </head><body></body></html>"#,
        );
        let p = select_pagination(&html);
        assert_eq!(p.prev.as_deref(), Some("/page/1"));
        assert_eq!(p.next.as_deref(), Some("/page/3"));
        assert_eq!(p.amphtml.as_deref(), Some("/page/2/amp"));
    }

    #[test]
    fn absent_links_are_none_not_empty_strings() {
        let html = Html::parse_document("<html><head></head><body></body></html>");
        let p = select_pagination(&html);
        assert!(p.next.is_none() && p.prev.is_none() && p.amphtml.is_none());
    }

    #[test]
    fn blank_href_is_treated_as_absent() {
        // An empty href is a template that failed to render, not a real link.
        let html = Html::parse_document(r#"<link rel="next" href="   ">"#);
        assert!(select_pagination(&html).next.is_none());
    }
}
