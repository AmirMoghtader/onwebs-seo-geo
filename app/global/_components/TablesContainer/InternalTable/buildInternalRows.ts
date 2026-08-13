// Merges everything the crawl found into Screaming Frog's single "Internal"
// list: HTML pages plus the images, scripts, stylesheets and documents they
// reference — then flattens each into the flat shape columns.ts reads.
//
// Why this exists: our crawler already finds all of these, but the UI split
// them across separate tabs, so the app appeared to have found far fewer URLs
// than Screaming Frog reported. SF's export of the same site was 228 rows —
// 126 HTML pages and 102 assets — while our HTML-only view showed 129.

import { contentTypeFor } from "@/app/lib/contentType";
import { isFetchableUrl } from "@/app/lib/crawlUniverse";
import { linkCountsFor } from "@/app/lib/linkCounts";
import { pageSizeFor } from "@/app/lib/pageSize";

const numOr = (v: any, fallback: any = "") =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export function buildInternalRows(
  pages: any[],
  aggregated: { images?: any[]; scripts?: any[]; css?: any[]; files?: any[] },
  /**
   * Inlink totals from the backend, keyed by normalised URL. The tally below
   * can only see links the pages in memory happen to carry, and the paged
   * query strips those arrays entirely — which is why every row read 0. When
   * the backend's answer is present it wins, because it was computed over the
   * whole crawl in SQLite rather than over whatever this process holds.
   */
  inlinkCounts: Record<string, { inlinks: number; unique: number }> = {},
): any[] {
  const rows: any[] = [];
  const seen = new Set<string>();

  const push = (r: any) => {
    if (!r.address || seen.has(r.address) || !isFetchableUrl(r.address)) return;
    seen.add(r.address);
    rows.push(r);
  };

  // Inlink counts are a property of the whole crawl, not of one page, so they
  // are tallied up front: every internal link found anywhere is a vote for its
  // destination.
  const inlinkTotals = new Map<string, number>();
  const inlinkSources = new Map<string, Set<string>>();
  const key = (u: string) => String(u || "").split("#")[0].replace(/\/$/, "");

  for (const p of pages || []) {
    const from = p?.url;
    const pool = p?.inoutlinks_status_codes?.internal || p?.internal_links || [];
    if (!Array.isArray(pool)) continue;
    for (const l of pool) {
      const to = key(typeof l === "string" ? l : l?.url || l?.href || l?.link);
      if (!to) continue;
      inlinkTotals.set(to, (inlinkTotals.get(to) || 0) + 1);
      if (from) {
        const set = inlinkSources.get(to) || new Set<string>();
        set.add(key(from));
        inlinkSources.set(to, set);
      }
    }
  }

  // Pages first, shallowest first, so the URL you typed is row 1 and the
  // site reads top-down the way you think about it. Results arrive in
  // whatever order the concurrent fetches finish, which is why a cached CSS
  // path five levels deep was showing above the homepage.
  const orderedPages = [...(pages || [])].sort((a, b) => {
    const da = Number(a?.url_depth);
    const db = Number(b?.url_depth);
    const sa = Number.isFinite(da) ? da : 99;
    const sb = Number.isFinite(db) ? db : 99;
    if (sa !== sb) return sa - sb;
    // Within a depth, shorter addresses first — the section root before its
    // children.
    return String(a?.url || "").length - String(b?.url || "").length;
  });

  // 1. HTML pages — the full-detail rows
  for (const p of orderedPages) {
    const url = p?.url || "";
    if (!url) continue;

    const meta = p?.page_meta || {};
    const pag = p?.pagination || {};
    const robots = p?.meta_robots?.meta_robots || [];
    const h2 = p?.headings?.h2 || [];
    const k = key(url);

    push({
      address: url,
      url,
      contentType: p?.content_type || "text/html",
      statusCode: numOr(p?.status_code),
      indexability:
        (p?.indexability?.indexability ?? 0.5) >= 0.5 ? "Indexable" : "Non-Indexable",
      indexabilityStatus: p?.indexability?.indexability_reason || "",

      title: p?.title?.[0]?.title || "",
      metaDescription: p?.description || "",
      metaKeywords: meta.meta_keywords || "",
      h1: p?.headings?.h1?.[0] || "",
      h2_1: h2[0] || "",
      h2_2: h2[1] || "",

      metaRobots1: robots[0] || "",
      metaRobots2: robots[1] || "",
      xRobotsTag: meta.x_robots_tag || "",
      metaRefresh: meta.meta_refresh || "",

      canonical: (p?.canonicals || [])[0] || "",
      relNext: pag.next || "",
      relPrev: pag.prev || "",
      httpRelNext: meta.http_rel_next || "",
      httpRelPrev: meta.http_rel_prev || "",
      amphtml: pag.amphtml || "",

      ...pageSizeFor(p),

      wordCount: numOr(p?.word_count),
      sentenceCount: numOr(p?.sentence_count),
      flesch:
        typeof p?.flesch === "number"
          ? p.flesch.toFixed(2)
          : p?.flesch?.Ok?.[0] != null
            ? Number(p.flesch.Ok[0]).toFixed(2)
            : "",
      readability: p?.flesch_grade || p?.flesch?.Ok?.[1] || "",
      textRatio:
        typeof p?.text_ratio === "number"
          ? p.text_ratio.toFixed(2)
          : p?.text_ratio?.[0]?.text_ratio != null
            ? Number(p.text_ratio[0].text_ratio).toFixed(2)
            : "",

      depth: numOr(p?.url_depth),
      linkScore: numOr(p?.link_score),

      inlinks: inlinkCounts[k]?.inlinks ?? inlinkTotals.get(k) ?? 0,
      uniqueInlinks: inlinkCounts[k]?.unique ?? inlinkSources.get(k)?.size ?? 0,
      ...linkCountsFor(p),

      crawlError: p?.crawl_error || "",
      hash: meta.content_hash || "",
      responseTime: p?.response_time != null ? Number(p.response_time).toFixed(2) : "",
      lastModified: meta.last_modified || "",
      redirectUrl: p?.redirect_url || "",
      redirectType: p?.redirection_type || "",
      cookies:
        typeof p?.cookies_count === "number"
          ? p.cookies_count
          : Array.isArray(p?.cookies?.Ok)
            ? p.cookies.Ok.length
            : Array.isArray(p?.cookies)
              ? p.cookies.length
              : "",
      language: p?.language || "",
      httpVersion: meta.http_version || "",
      mobileAlternate: meta.mobile_alternate || "",
      crawlTimestamp: meta.crawl_timestamp || "",
    });
  }

  // 1b. Redirect hops are NOT synthesised here any more.
  //
  // The crawler now stores every 3xx source as its own real row with its true
  // status, so rebuilding them from redirect_chain produced a second, slightly
  // different row for the same hop whenever the addresses disagreed on a
  // trailing slash or encoding. The chain stays available for the details
  // drawer and the redirect report; the table shows only rows that exist in
  // SQLite.

  // 2-4. Assets. They were seen as references inside a page, never parsed, so
  // only the identity columns are populated; check_assets_command fills status
  // and size in afterwards.
  const asset = (url: string, extra: any = {}) => ({
    address: url,
    url,
    contentType: contentTypeFor(url, extra.contentType),
    statusCode: extra.statusCode ?? "",
    indexability: extra.statusCode && Number(extra.statusCode) < 400 ? "Indexable" : "",
    indexabilityStatus: "",
    // SF leaves Title blank for assets — an image's alt text is not a page
    // title, and putting it here made PNGs look like they had one.
    title: "",
    alt: extra.title || "",
    metaDescription: "", metaKeywords: "", h1: "", h2_1: "", h2_2: "",
    metaRobots1: "", metaRobots2: "", xRobotsTag: "", metaRefresh: "",
    canonical: "", relNext: "", relPrev: "", httpRelNext: "", httpRelPrev: "",
    amphtml: "",
    sizeBytes: extra.sizeBytes ?? "", transferredBytes: extra.sizeBytes ?? "",
    wordCount: "", sentenceCount: "", flesch: "", readability: "", textRatio: "",
    depth: "", linkScore: "",
    inlinks: inlinkCounts[key(url)]?.inlinks ?? inlinkTotals.get(key(url)) ?? "",
    uniqueInlinks:
      inlinkCounts[key(url)]?.unique ?? inlinkSources.get(key(url))?.size ?? "",
    outlinks: "", uniqueOutlinks: "", externalOutlinks: "", uniqueExternalOutlinks: "",
    crawlError: "",
    hash: "", responseTime: "", lastModified: "",
    redirectUrl: "", redirectType: "", cookies: "", language: "",
    httpVersion: "", mobileAlternate: "",
    crawlTimestamp: "",
    foundAt: extra.foundAt || "",
  });

  for (const img of aggregated?.images || []) {
    const url = Array.isArray(img) ? img[0] : img?.url || img?.src || "";
    if (!url) continue;
    const weight = Array.isArray(img) ? img[2] : img?.size ?? img?.weight;
    const status = Array.isArray(img) ? img[4] : img?.status;
    push(
      asset(url, {
        contentType: Array.isArray(img) ? img[3] : img?.type,
        statusCode: typeof status === "number" && status > 0 ? status : "",
        sizeBytes: numOr(Number(weight)),
        title: Array.isArray(img) ? img[1] || "" : img?.alt || "",
        foundAt: Array.isArray(img) ? "" : img?.page || img?.found_at || "",
      }),
    );
  }

  for (const url of aggregated?.scripts || []) {
    if (url) push(asset(url, { contentType: "application/javascript" }));
  }
  for (const url of aggregated?.css || []) {
    if (url) push(asset(url, { contentType: "text/css" }));
  }
  for (const f of aggregated?.files || []) {
    const url = typeof f === "string" ? f : f?.url;
    if (url) push(asset(url, { foundAt: typeof f === "string" ? "" : f?.found_at || f?.page }));
  }

  return rows;
}
