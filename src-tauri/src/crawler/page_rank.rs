//! Domain authority from Open PageRank, as an opt-in connector.
//!
//! This started life sending every domain the user audited to a third party,
//! using a credential compiled into the binary. That is a real privacy
//! problem — an SEO tool should not quietly report what you are looking at —
//! and the credential was not even ours to spend. It is a setting now, so the
//! request happens because the user asked for it.
//!
//! The service moved hosts and changed protocol on the way, and both forms are
//! still in circulation:
//!
//! | key issued by | endpoint | auth |
//! |---|---|---|
//! | `openpagerank.com` (legacy) | `…/api/v1.0/getPageRank` GET | `API-OPR` header |
//! | Keywords Everywhere (current) | `…/v1/domains/bulk` POST | `Authorization: Bearer` |
//!
//! A key issued today only authenticates against the second one, so the shape
//! of the key decides the call rather than a separate setting the user would
//! have to understand.

use serde::Deserialize;
use std::error::Error;

const LEGACY_ENDPOINT: &str = "https://openpagerank.com/api/v1.0/getPageRank";
const CURRENT_ENDPOINT: &str = "https://openpagerank.keywordseverywhere.com/v1/domains/bulk";

/// Legacy keys are 40 lowercase alphanumerics. Anything else is treated as a
/// current key, which fails loudly against the new endpoint rather than
/// silently returning nothing from the old one.
fn is_legacy_key(key: &str) -> bool {
    key.len() == 40 && key.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

#[derive(Deserialize)]
struct LegacyResponse {
    response: Vec<LegacyEntry>,
}

#[derive(Deserialize)]
struct LegacyEntry {
    #[serde(default)]
    page_rank_decimal: f32,
}

#[derive(Deserialize)]
struct BulkResponse {
    #[serde(default)]
    data: Vec<BulkEntry>,
}

#[derive(Deserialize)]
struct BulkEntry {
    #[serde(default)]
    page_rank_decimal: f32,
}

/// The PageRank of `url`'s domain, or `None` when no key is configured.
///
/// `None` is not an error: it is the ordinary state of a fresh install, and
/// the caller renders an empty cell rather than a zero that looks measured.
pub async fn fetch_page_rank(url: &str, api_key: &str) -> Result<Option<f32>, Box<dyn Error>> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Ok(None);
    }

    let domain = url::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_string))
        .ok_or("PageRank lookup needs an absolute URL")?;

    let client = reqwest::Client::new();

    let score = if is_legacy_key(api_key) {
        let response = client
            .get(LEGACY_ENDPOINT)
            .query(&[("domains[]", domain.as_str())])
            .header("API-OPR", api_key)
            .send()
            .await?
            .error_for_status()?
            .json::<LegacyResponse>()
            .await?;
        response.response.first().map(|entry| entry.page_rank_decimal)
    } else {
        let response = client
            .post(CURRENT_ENDPOINT)
            .bearer_auth(api_key)
            .json(&serde_json::json!({ "domains": [domain] }))
            .send()
            .await?
            .error_for_status()?
            .json::<BulkResponse>()
            .await?;
        response.data.first().map(|entry| entry.page_rank_decimal)
    };

    Ok(score)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_shape_decides_which_service_is_called() {
        // The key that shipped inside RustySEO, and every key of that era.
        assert!(is_legacy_key("44ss8gok0oo0c8kcckog0sgg8sswoswccgo08g80"));
        // Keys issued now are longer and mixed-case.
        assert!(!is_legacy_key("kE_9aF2xQ7mNpR4tV8wZ1yB6cD3gH5jL0sT2uX4nA7bM9eK1"));
        assert!(!is_legacy_key(""));
    }

    #[tokio::test]
    async fn no_key_means_no_request_and_no_error() {
        // A fresh install must not fail an audit just because a connector is
        // unconfigured, and must not call anyone.
        assert_eq!(fetch_page_rank("https://example.com/", "").await.unwrap(), None);
        assert_eq!(fetch_page_rank("https://example.com/", "   ").await.unwrap(), None);
    }

    #[tokio::test]
    async fn a_relative_url_is_refused_rather_than_guessed() {
        assert!(fetch_page_rank("/just/a/path", "somekey").await.is_err());
    }
}
