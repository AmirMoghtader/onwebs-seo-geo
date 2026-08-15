//! How big is this site, before we agree to crawl it?
//!
//! A phone is not a workstation. Pointed at a large marketplace it will spend
//! hours, fill its storage and get nothing usable back, and the person holding
//! it has no way to know that in advance. So the site is measured first, from
//! its own sitemaps, and the answer decides whether the crawl is offered,
//! offered with a warning, or refused.
//!
//! Sitemaps are the only cheap measure available: a handful of requests, no
//! crawling. They undercount a site that keeps some pages out of them, which
//! is why the thresholds below are generous rather than exact.

use serde::Serialize;
use std::time::Duration;
use url::Url;

use crate::domain_crawler::helpers::robots::RobotsPolicyCache;

/// Above this the crawl is offered only with a warning and a sample option.
pub const WARN_ABOVE: usize = 5_000;

/// Above this a phone is not going to finish, so it is not offered at all.
pub const REFUSE_ABOVE: usize = 10_000;

/// How much of an oversized site a sample crawl covers.
pub const SAMPLE_SIZE: usize = 1_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteSize {
    /// URLs found in the sitemaps. Zero when the site publishes none.
    pub urls: usize,
    /// False when there was no sitemap to read, so `urls` proves nothing and
    /// the caller should not treat a small number as a small site.
    pub from_sitemap: bool,
    /// "ok" | "warn" | "refuse" — the decision, made in one place so the
    /// phone and any later caller cannot disagree about the thresholds.
    pub verdict: &'static str,
    pub warn_above: usize,
    pub refuse_above: usize,
    pub sample_size: usize,
}

fn verdict_for(urls: usize, from_sitemap: bool) -> &'static str {
    if !from_sitemap {
        // An unmeasured site is not a refusal: most sites without a sitemap
        // are small, and refusing them would be worse than letting the crawl's
        // own per-domain cap do its job.
        return "ok";
    }
    if urls > REFUSE_ABOVE {
        "refuse"
    } else if urls > WARN_ABOVE {
        "warn"
    } else {
        "ok"
    }
}

/// Counts the URLs a site publishes, without crawling it.
pub async fn measure(domain: &str, robots_user_agent: &str) -> Result<SiteSize, String> {
    let mut base = Url::parse(domain).map_err(|_| format!("Not a valid URL: {}", domain))?;

    // Sites commonly answer on one host and redirect to another —
    // digikala.com sends a 301 to www.digikala.com. Measuring the address as
    // typed found no robots.txt there, reported "no sitemap", and let a site
    // with millions of pages through as unmeasurable.
    if let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent(robots_user_agent)
        .build()
    {
        if let Ok(response) = client.get(base.as_str()).send().await {
            let landed = response.url().clone();
            if landed.host_str() != base.host_str() {
                base = landed;
            }
        }
    }

    // Short timeouts: this runs while someone waits on a button, and a site
    // that cannot answer in a few seconds is better treated as unmeasured
    // than left spinning.
    let cache = RobotsPolicyCache::new(
        robots_user_agent.to_string(),
        Duration::from_secs(8),
        Duration::from_secs(5),
        8,
    )
    .map_err(|error| format!("Could not prepare the request: {}", error))?;

    let declared = cache
        .robots_data_for(&base)
        .await
        .map(|data| data.sitemap_urls)
        .unwrap_or_default();

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(5))
        .user_agent(robots_user_agent)
        .build()
        .map_err(|error| format!("Could not prepare the request: {}", error))?;

    let (count, from_sitemap) = count_urls(&client, &base, &declared).await;

    Ok(SiteSize {
        urls: count,
        from_sitemap,
        verdict: verdict_for(count, from_sitemap),
        warn_above: WARN_ABOVE,
        refuse_above: REFUSE_ABOVE,
        sample_size: SAMPLE_SIZE,
    })
}

/// Sitemaps to open before giving up on an exact figure. A marketplace
/// publishes hundreds; reading them all to learn "too many" would cost more
/// than the crawl this check exists to prevent.
const MAX_SITEMAPS: usize = 12;

/// Counts `<loc>` entries, stopping as soon as the answer cannot change.
///
/// The first version read every sitemap to the end. Pointed at digikala.com it
/// was still downloading after thirty seconds with the button showing a
/// spinner — the measurement had become the expensive thing. Once the count is
/// past the refusal threshold the verdict is settled, so it stops there.
async fn count_urls(
    client: &reqwest::Client,
    base: &Url,
    declared: &[String],
) -> (usize, bool) {
    let mut queue: Vec<String> = if declared.is_empty() {
        vec![base
            .join("/sitemap.xml")
            .map(|u| u.to_string())
            .unwrap_or_default()]
    } else {
        declared.to_vec()
    };

    let mut seen = std::collections::HashSet::new();
    let mut total = 0usize;
    let mut opened = 0usize;
    let mut any = false;

    while let Some(next) = queue.pop() {
        if opened >= MAX_SITEMAPS || total > REFUSE_ABOVE {
            break;
        }
        if next.is_empty() || !seen.insert(next.clone()) {
            continue;
        }
        opened += 1;

        let Ok(response) = client.get(&next).send().await else { continue };
        if !response.status().is_success() {
            continue;
        }
        let Ok(body) = response.text().await else { continue };

        // A sitemap index points at more sitemaps; a sitemap lists pages. Both
        // use <loc>, and the wrapper tag is what tells them apart.
        let is_index = body.contains("<sitemapindex");
        let locs = body.matches("<loc>").count();
        if locs > 0 {
            any = true;
        }

        if is_index {
            for part in body.split("<loc>").skip(1) {
                if let Some(end) = part.find("</loc>") {
                    queue.push(part[..end].trim().to_string());
                }
            }
        } else {
            total += locs;
        }
    }

    (total, any)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_thresholds_decide_in_one_place() {
        assert_eq!(verdict_for(0, true), "ok");
        assert_eq!(verdict_for(WARN_ABOVE, true), "ok");
        assert_eq!(verdict_for(WARN_ABOVE + 1, true), "warn");
        assert_eq!(verdict_for(REFUSE_ABOVE, true), "warn");
        assert_eq!(verdict_for(REFUSE_ABOVE + 1, true), "refuse");
    }

    #[test]
    fn a_site_with_no_sitemap_is_not_refused_on_a_number_we_do_not_have() {
        // Zero URLs here means "nothing to read", not "an empty site", and a
        // huge site that publishes no sitemap would otherwise sail through as
        // if it were tiny — so the decision defers to the crawl's own cap.
        assert_eq!(verdict_for(0, false), "ok");
        assert_eq!(verdict_for(999_999, false), "ok");
    }
}
