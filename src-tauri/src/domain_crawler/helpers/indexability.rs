use once_cell::sync::Lazy;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Indexability {
    pub indexability: f32,
    pub indexability_reason: String,
}

static META_SELECTOR: Lazy<Selector> = Lazy::new(|| Selector::parse("meta[name]").unwrap());
static LINK_SELECTOR: Lazy<Selector> = Lazy::new(|| Selector::parse("link[rel]").unwrap());

#[derive(Default)]
struct RobotsDirectives {
    noindex: bool,
    nofollow: bool,
    explicit_index: bool,
}

/// Backwards-compatible document-only analysis.
///
/// Call [`extract_indexability_with_context`] when response status, headers and
/// the final response URL are available; those facts are required to correctly
/// classify redirects/errors, X-Robots-Tag and canonicalised pages.
pub fn extract_indexability(document: &Html) -> Indexability {
    extract_indexability_with_context(document, 200, &[], None)
}

/// Classify a fetched page using the HTTP and HTML signals search engines use.
///
/// `headers` may contain repeated header names. `page_url` should be the final
/// response URL so relative canonicals can be resolved and self-references can
/// be distinguished from canonicalisation to another URL.
pub fn extract_indexability_with_context(
    document: &Html,
    status_code: u16,
    headers: &[(String, String)],
    page_url: Option<&Url>,
) -> Indexability {
    if !(200..300).contains(&status_code) || status_code == 204 {
        return non_indexable(format!("Not indexable: HTTP status {}", status_code));
    }

    let header_directives = headers
        .iter()
        .filter(|(name, _)| name.eq_ignore_ascii_case("x-robots-tag"))
        .fold(RobotsDirectives::default(), |mut combined, (_, value)| {
            combined.merge(parse_robots_directives(value));
            combined
        });
    if header_directives.noindex {
        return non_indexable("Not indexable: X-Robots-Tag contains noindex");
    }

    let mut meta_directives = RobotsDirectives::default();
    for element in document.select(&META_SELECTOR) {
        let Some(name) = element.value().attr("name") else {
            continue;
        };
        if !matches_robots_agent(name) {
            continue;
        }
        if let Some(content) = element.value().attr("content") {
            meta_directives.merge(parse_robots_directives(content));
        }
    }
    if meta_directives.noindex {
        return non_indexable("Not indexable: meta robots contains noindex");
    }

    let canonical_hrefs = canonical_hrefs(document);
    if canonical_hrefs.len() > 1 {
        return non_indexable("Not indexable: multiple canonical links found");
    }
    if let Some(href) = canonical_hrefs.first() {
        match page_url {
            Some(own_url) => match own_url.join(href) {
                Ok(canonical_url) if equivalent_resource(own_url, &canonical_url) => {
                    return indexable("Indexable: self-referencing canonical");
                }
                Ok(canonical_url) => {
                    return non_indexable(format!(
                        "Not indexable: canonical points to {}",
                        canonical_url
                    ));
                }
                Err(_) => {
                    return non_indexable(format!(
                        "Not indexable: invalid canonical URL '{}'",
                        href
                    ));
                }
            },
            None => {
                // The compatibility API cannot establish whether this is a
                // self-reference. Keep the historical, neutral classification.
                return Indexability {
                    indexability: 0.5,
                    indexability_reason: format!(
                        "Canonical found but page URL was unavailable: {}",
                        href
                    ),
                };
            }
        }
    }

    if header_directives.nofollow || meta_directives.nofollow {
        return Indexability {
            indexability: 0.8,
            indexability_reason: "Indexable: nofollow directive present".to_string(),
        };
    }
    if header_directives.explicit_index || meta_directives.explicit_index {
        return indexable("Indexable: explicit index directive present");
    }

    indexable("Indexable: successful response with no blocking directive")
}

impl RobotsDirectives {
    fn merge(&mut self, other: Self) {
        self.noindex |= other.noindex;
        self.nofollow |= other.nofollow;
        self.explicit_index |= other.explicit_index;
    }
}

fn matches_robots_agent(name: &str) -> bool {
    matches!(
        name.trim().to_ascii_lowercase().as_str(),
        "robots" | "googlebot" | "googlebot-news" | "bingbot"
    )
}

fn parse_robots_directives(value: &str) -> RobotsDirectives {
    let mut parsed = RobotsDirectives::default();

    for raw_part in value.split([',', ';']) {
        let mut part = raw_part.trim().to_ascii_lowercase();
        if let Some((prefix, rest)) = part.split_once(':') {
            // X-Robots-Tag permits an optional crawler-name prefix. Directives
            // such as `unavailable_after:` are unrelated to index/noindex.
            if matches_robots_agent(prefix) {
                part = rest.trim().to_string();
            } else {
                continue;
            }
        }

        for token in part.split_whitespace() {
            match token.trim_matches(|ch: char| !ch.is_ascii_alphanumeric()) {
                "none" => {
                    parsed.noindex = true;
                    parsed.nofollow = true;
                }
                "noindex" => parsed.noindex = true,
                "nofollow" => parsed.nofollow = true,
                "all" | "index" => parsed.explicit_index = true,
                _ => {}
            }
        }
    }
    parsed
}

fn canonical_hrefs(document: &Html) -> Vec<String> {
    document
        .select(&LINK_SELECTOR)
        .filter(|element| {
            element
                .value()
                .attr("rel")
                .is_some_and(|rel| {
                    rel.split_ascii_whitespace()
                        .any(|value| value.eq_ignore_ascii_case("canonical"))
                })
        })
        .filter_map(|element| element.value().attr("href"))
        .map(str::trim)
        .filter(|href| !href.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn equivalent_resource(left: &Url, right: &Url) -> bool {
    let mut left = left.clone();
    let mut right = right.clone();
    left.set_fragment(None);
    right.set_fragment(None);
    left == right
}

/// Classify a fetched non-HTML resource (PDF, image, script, stylesheet, ...).
///
/// A PDF returned with a 2xx and no robots restriction is genuinely indexable —
/// search engines index PDFs and rank them — so it must not be lumped in with
/// binaries that never appear in an index. Every other content type keeps a
/// precise, content-type specific reason.
pub fn extract_resource_indexability(
    status_code: u16,
    headers: &[(String, String)],
    content_type: &str,
    resource_url: Option<&Url>,
) -> Indexability {
    if !(200..300).contains(&status_code) || status_code == 204 {
        return non_indexable(format!("Not indexable: HTTP status {}", status_code));
    }

    let header_directives = headers
        .iter()
        .filter(|(name, _)| name.eq_ignore_ascii_case("x-robots-tag"))
        .fold(RobotsDirectives::default(), |mut combined, (_, value)| {
            combined.merge(parse_robots_directives(value));
            combined
        });
    if header_directives.noindex {
        return non_indexable("Not indexable: X-Robots-Tag contains noindex");
    }

    if is_pdf_resource(content_type, resource_url) {
        return indexable("Indexable: PDF document");
    }

    non_indexable(format!(
        "Not indexable: non-HTML content ({})",
        content_type
    ))
}

/// PDFs are detected by MIME type first, falling back to the path extension for
/// servers that mislabel them as `application/octet-stream`.
fn is_pdf_resource(content_type: &str, resource_url: Option<&Url>) -> bool {
    let mime_is_pdf = content_type
        .split(';')
        .next()
        .map(str::trim)
        .is_some_and(|mime| mime.eq_ignore_ascii_case("application/pdf"));
    if mime_is_pdf {
        return true;
    }

    resource_url.is_some_and(|url| {
        url.path_segments()
            .and_then(|mut segments| segments.next_back())
            .is_some_and(|last| last.to_ascii_lowercase().ends_with(".pdf"))
    })
}

fn indexable(reason: impl Into<String>) -> Indexability {
    Indexability {
        indexability: 1.0,
        indexability_reason: reason.into(),
    }
}

fn non_indexable(reason: impl Into<String>) -> Indexability {
    Indexability {
        indexability: 0.0,
        indexability_reason: reason.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        extract_indexability, extract_indexability_with_context, extract_resource_indexability,
    };
    use scraper::Html;
    use url::Url;

    fn analyse_resource(
        status: u16,
        headers: &[(&str, &str)],
        content_type: &str,
        url: &str,
    ) -> super::Indexability {
        let headers = headers
            .iter()
            .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
            .collect::<Vec<_>>();
        let url = Url::parse(url).unwrap();
        extract_resource_indexability(status, &headers, content_type, Some(&url))
    }

    #[test]
    fn pdf_with_clean_200_is_indexable() {
        let by_mime = analyse_resource(200, &[], "application/pdf", "https://example.com/a");
        assert_eq!(by_mime.indexability, 1.0);

        // charset parameters and mislabelled MIME types still resolve to PDF
        assert_eq!(
            analyse_resource(200, &[], "application/pdf; charset=binary", "https://e.com/a")
                .indexability,
            1.0
        );
        assert_eq!(
            analyse_resource(
                200,
                &[],
                "application/octet-stream",
                "https://example.com/docs/Guide.PDF"
            )
            .indexability,
            1.0
        );
    }

    #[test]
    fn pdf_blocked_by_x_robots_or_status_is_not_indexable() {
        let blocked = analyse_resource(
            200,
            &[("X-Robots-Tag", "noindex")],
            "application/pdf",
            "https://example.com/a.pdf",
        );
        assert_eq!(blocked.indexability, 0.0);
        assert!(blocked.indexability_reason.contains("X-Robots-Tag"));

        assert_eq!(
            analyse_resource(404, &[], "application/pdf", "https://example.com/a.pdf")
                .indexability,
            0.0
        );
    }

    #[test]
    fn other_binaries_stay_non_indexable_with_a_precise_reason() {
        let png = analyse_resource(200, &[], "image/png", "https://example.com/a.png");
        assert_eq!(png.indexability, 0.0);
        assert!(png.indexability_reason.contains("image/png"));
    }

    fn analyse(
        html: &str,
        status: u16,
        headers: &[(&str, &str)],
        url: &str,
    ) -> super::Indexability {
        let headers = headers
            .iter()
            .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
            .collect::<Vec<_>>();
        let url = Url::parse(url).unwrap();
        extract_indexability_with_context(
            &Html::parse_document(html),
            status,
            &headers,
            Some(&url),
        )
    }

    #[test]
    fn status_errors_and_no_content_are_not_indexable() {
        assert_eq!(
            analyse("", 301, &[], "https://example.com/").indexability,
            0.0
        );
        assert_eq!(
            analyse("", 404, &[], "https://example.com/").indexability,
            0.0
        );
        assert_eq!(
            analyse("", 204, &[], "https://example.com/").indexability,
            0.0
        );
    }

    #[test]
    fn x_robots_tag_is_case_insensitive_and_restrictive_across_headers() {
        let result = analyse(
            "<meta name='robots' content='index, follow'>",
            200,
            &[
                ("X-Robots-Tag", "googlebot: FOLLOW"),
                ("x-robots-tag", " NoIndex "),
            ],
            "https://example.com/",
        );
        assert_eq!(result.indexability, 0.0);
        assert!(result.indexability_reason.contains("X-Robots-Tag"));
    }

    #[test]
    fn meta_directive_order_case_spacing_and_multiple_tags_are_supported() {
        let result = analyse(
            "<meta name='ROBOTS' content=' FOLLOW , INDEX '><meta name='googlebot' content=' nofollow ; NOINDEX '>",
            200,
            &[],
            "https://example.com/",
        );
        assert_eq!(result.indexability, 0.0);
        assert!(result.indexability_reason.contains("meta robots"));
    }

    #[test]
    fn distinguishes_relative_self_and_non_self_canonicals() {
        let own = analyse(
            "<link rel='alternate CANONICAL' href='/a#fragment'>",
            200,
            &[],
            "https://example.com/a",
        );
        assert_eq!(own.indexability, 1.0);

        let other = analyse(
            "<link rel='Canonical' href='../b'>",
            200,
            &[],
            "https://example.com/path/a",
        );
        assert_eq!(other.indexability, 0.0);
        assert!(other.indexability_reason.contains("https://example.com/b"));
    }

    #[test]
    fn compatibility_api_still_honours_noindex() {
        let document = Html::parse_document("<meta name='robots' content='follow, noindex'>");
        assert_eq!(extract_indexability(&document).indexability, 0.0);
    }
}
