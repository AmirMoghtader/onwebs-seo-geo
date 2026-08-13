//! Forms on a page, and where they submit to.
//!
//! Screaming Frog reports `Form N Action Link` and `Form N Action Path Type`,
//! and flags two things worth knowing: a form on an insecure page, and a form
//! on a secure page whose action posts to an insecure one. The second is the
//! nastier of the pair — the padlock is showing while the data leaves in the
//! clear.

use once_cell::sync::Lazy;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use url::Url;

static FORM_SELECTOR: Lazy<Selector> = Lazy::new(|| Selector::parse("form").unwrap());

/// How the action was written in the markup. Screaming Frog's "Path Type"; it
/// says nothing about where the form submits, only how the author spelled it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PathType {
    /// `https://example.com/submit`
    Absolute,
    /// `//example.com/submit` — inherits the page's scheme
    ProtocolRelative,
    /// `/submit`
    RootRelative,
    /// `submit` or `../submit`
    Relative,
    /// no `action` attribute: the form posts back to the page itself
    SelfReferencing,
}

impl PathType {
    fn of(raw: &str) -> Self {
        let raw = raw.trim();
        if raw.is_empty() {
            Self::SelfReferencing
        } else if raw.starts_with("//") {
            Self::ProtocolRelative
        } else if Url::parse(raw).is_ok() {
            Self::Absolute
        } else if raw.starts_with('/') {
            Self::RootRelative
        } else {
            Self::Relative
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormAction {
    /// The action resolved against the page, so it can be clicked or checked.
    pub action: String,
    pub path_type: PathType,
    /// GET when the form did not say.
    pub method: String,
    /// The form submits over plain HTTP. True whether the page itself was
    /// secure or not — this is about where the data goes.
    pub insecure: bool,
}

/// Every form on the page, in document order.
pub fn extract_forms(document: &Html, page_url: &Url) -> Vec<FormAction> {
    document
        .select(&FORM_SELECTOR)
        .map(|element| {
            let raw = element.value().attr("action").unwrap_or("");
            let path_type = PathType::of(raw);

            // An absent action means "this page", which is what joining an
            // empty string against the page URL already yields.
            let resolved = page_url
                .join(raw)
                .unwrap_or_else(|_| page_url.clone());

            FormAction {
                action: resolved.to_string(),
                path_type,
                method: element
                    .value()
                    .attr("method")
                    .map(|m| m.trim().to_uppercase())
                    .filter(|m| !m.is_empty())
                    .unwrap_or_else(|| "GET".to_string()),
                insecure: resolved.scheme() == "http",
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn forms(html: &str, page: &str) -> Vec<FormAction> {
        extract_forms(&Html::parse_document(html), &Url::parse(page).unwrap())
    }

    #[test]
    fn resolves_each_spelling_of_an_action_against_the_page() {
        let found = forms(
            r#"<form action="https://pay.example.net/x"></form>
               <form action="//cdn.example.net/y"></form>
               <form action="/search"></form>
               <form action="reply"></form>
               <form></form>"#,
            "https://example.com/blog/post/",
        );

        let seen: Vec<(&str, PathType)> = found
            .iter()
            .map(|f| (f.action.as_str(), f.path_type))
            .collect();

        assert_eq!(
            seen,
            vec![
                ("https://pay.example.net/x", PathType::Absolute),
                ("https://cdn.example.net/y", PathType::ProtocolRelative),
                ("https://example.com/search", PathType::RootRelative),
                ("https://example.com/blog/post/reply", PathType::Relative),
                ("https://example.com/blog/post/", PathType::SelfReferencing),
            ]
        );
    }

    #[test]
    fn a_secure_page_posting_to_http_is_still_insecure() {
        // The padlock is showing and the data leaves in the clear.
        let found = forms(
            r#"<form action="http://legacy.example.net/login" method="post"></form>"#,
            "https://example.com/",
        );
        assert!(found[0].insecure);
        assert_eq!(found[0].method, "POST");
    }

    #[test]
    fn a_form_that_stays_on_https_is_not_flagged() {
        let found = forms(r#"<form action="/login"></form>"#, "https://example.com/");
        assert!(!found[0].insecure);
        assert_eq!(found[0].method, "GET", "an unstated method is GET");
    }

    #[test]
    fn a_page_with_no_forms_yields_none() {
        assert!(forms("<html><body><p>hi</p></body></html>", "https://e.com/").is_empty());
    }
}
