use once_cell::sync::Lazy;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct JavaScript {
    pub external: Vec<String>, // URLs of external scripts
    pub inline: Vec<String>,   // Content of inline scripts
}

static SCRIPT_SELECTOR: Lazy<Selector> = Lazy::new(|| Selector::parse("script").unwrap());

pub fn extract_javascript(document: &Html, base_url: &Url) -> JavaScript {
    let mut javascript = JavaScript {
        external: Vec::new(),
        inline: Vec::new(),
    };

    for element in document.select(&SCRIPT_SELECTOR) {
        if let Some(src) = element.value().attr("src") {
            // External script: add the URL
            //concatenate the base URL with the relative URL
            if let Ok(full_src) = base_url.join(src) {
                javascript.external.push(full_src.to_string());
            }
        } else {
            // Inline script: add the text content
            let inline_js = element.text().collect::<String>();
            if !inline_js.trim().is_empty() {
                javascript.inline.push(inline_js);
            }
        }
    }

    javascript
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_scripts_are_resolved_against_the_page() {
        let document = Html::parse_document(
            r#"<html><head>
                 <script src="/assets/app.js"></script>
                 <script src="https://cdn.example.net/lib.js"></script>
                 <script>window.dataLayer = [];</script>
                 <script></script>
               </head></html>"#,
        );
        let base = Url::parse("https://example.com/blog/post/").unwrap();

        let js = extract_javascript(&document, &base);

        assert_eq!(
            js.external,
            vec![
                "https://example.com/assets/app.js",
                "https://cdn.example.net/lib.js",
            ]
        );
        // The empty <script> contributes nothing; only the one with a body does.
        assert_eq!(js.inline.len(), 1);
    }

    #[test]
    fn a_page_without_scripts_reports_none_rather_than_failing() {
        let js = extract_javascript(
            &Html::parse_document("<html><body><p>hi</p></body></html>"),
            &Url::parse("https://example.com/").unwrap(),
        );
        assert!(js.external.is_empty() && js.inline.is_empty());
    }
}
