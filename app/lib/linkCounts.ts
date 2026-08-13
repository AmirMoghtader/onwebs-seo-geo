// One calculation for a page's outlink counts, read by both the Internal table
// and the URL Details drawer.
//
// They used to compute this separately and disagreed: 4cuatro.ai's homepage
// showed Outlinks 4 in the drawer and 0 in the table. Neither was buggy on its
// own — they were reading different records. The drawer loads the full crawl
// result, which carries the link arrays; the table is fed by the paged query,
// which drops those arrays to keep a large crawl out of memory and sends
// totals instead. Counting `.length` of an array that isn't there gave 0.
//
// So the arrays are used when present and the persisted totals when not, in
// one place, so the two views cannot drift again.

/** Distinct destinations, ignoring the fragment — Screaming Frog's "Unique". */
function uniqueDestinations(links: any[]): number {
  const seen = new Set<string>();
  for (const l of links) {
    const u = typeof l === "string" ? l : l?.url || l?.href || l?.link;
    if (u) seen.add(String(u).split("#")[0]);
  }
  return seen.size;
}

export interface LinkCounts {
  outlinks: number | "";
  uniqueOutlinks: number | "";
  externalOutlinks: number | "";
  uniqueExternalOutlinks: number | "";
}

const count = (arr: any, persisted: any): number | "" => {
  if (Array.isArray(arr)) return arr.length;
  return typeof persisted === "number" ? persisted : "";
};

const unique = (arr: any, persisted: any): number | "" => {
  if (Array.isArray(arr)) return uniqueDestinations(arr);
  return typeof persisted === "number" ? persisted : "";
};

export function linkCountsFor(page: any): LinkCounts {
  const links = page?.inoutlinks_status_codes;
  const internal = links?.internal ?? page?.internal_links;
  const external = links?.external ?? page?.external_links;

  return {
    outlinks: count(internal, page?.internal_links_count),
    uniqueOutlinks: unique(internal, page?.unique_internal_links_count),
    externalOutlinks: count(external, page?.external_links_count),
    uniqueExternalOutlinks: unique(external, page?.unique_external_links_count),
  };
}
