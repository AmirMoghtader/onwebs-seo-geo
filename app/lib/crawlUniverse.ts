// Every URL a crawl touched, in one list.
//
// The crawler returns HTML pages in `crawlData` and the assets those pages
// reference — images, stylesheets, scripts, documents — separately, in
// `aggregatedData`. The Internal table already merges the two, which is why it
// showed 218 rows while the Overview pane, reading `crawlData` alone, reported
// 143 crawled URLs, 0 images and 0 stylesheets. The numbers were not wrong so
// much as counted over different worlds.
//
// This is that merge, in the nested page shape the Overview's accessors read,
// so both panels can be handed the same universe.

import { contentTypeFor } from "./contentType";

/**
 * Whether this is a URL the crawl could have fetched.
 *
 * An inline `data:` image carries its bytes in the string itself — there is no
 * host, no request, no status. Counting them as URLs put 628 placeholder SVGs
 * into a websima.com crawl that found 820 "images", inflating every total that
 * touched them. The crawler no longer requests these; this keeps them out of
 * the counts for crawls already stored.
 */
export function isFetchableUrl(url: unknown): boolean {
  const s = String(url || "");
  return s.startsWith("http://") || s.startsWith("https://");
}

/**
 * An asset seen as a reference and never parsed. A URL, a content type and —
 * once the asset checker has run — a status. Everything a page carries and an
 * asset does not is absent rather than blank, and `is_asset` marks it so the
 * HTML-only filters (missing title, missing H1) skip it instead of reporting
 * every PNG on the site as a page with no title.
 */
function assetStub(url: string, contentType?: string, statusCode?: unknown): any {
  return {
    url,
    content_type: contentTypeFor(url, contentType),
    status_code: typeof statusCode === "number" && statusCode > 0 ? statusCode : 0,
    is_asset: true,
  };
}

export interface AggregatedAssets {
  images?: any[];
  scripts?: any[];
  css?: any[];
  files?: any[];
}

/**
 * Pages first, then their assets, deduplicated by URL. Ordering matches
 * `buildInternalRows` so a count taken here and a row count taken there
 * describe the same set.
 */
export function crawlUniverse(pages: any[], aggregated?: AggregatedAssets): any[] {
  const out: any[] = [];
  const seen = new Set<string>();

  const push = (row: any) => {
    const url = row?.url;
    if (!url || seen.has(url) || !isFetchableUrl(url)) return;
    seen.add(url);
    out.push(row);
  };

  for (const p of pages || []) push(p);

  for (const img of aggregated?.images || []) {
    const url = Array.isArray(img) ? img[0] : img?.url || img?.src || "";
    if (!url) continue;
    push(
      assetStub(
        url,
        Array.isArray(img) ? img[3] : img?.type,
        Array.isArray(img) ? img[4] : img?.status,
      ),
    );
  }
  for (const url of aggregated?.scripts || []) {
    if (url) push(assetStub(url, "application/javascript"));
  }
  for (const url of aggregated?.css || []) {
    if (url) push(assetStub(url, "text/css"));
  }
  for (const f of aggregated?.files || []) {
    const url = typeof f === "string" ? f : f?.url;
    if (url) push(assetStub(url));
  }

  return out;
}
