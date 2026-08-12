// Screaming Frog's per-tab filter dropdowns.
//
// SF's whole interaction model is: pick a tab, then narrow it with a filter
// whose label carries the count. "Page Titles > Duplicate" is how you actually
// find duplicate titles — not by eyeballing a 129-row table. This file holds
// those filter sets; the thresholds match SF's defaults.

export interface PageFilter {
  key: string;
  label: string;
  match: (row: any, all: any[]) => boolean;
}

export interface FilterSet {
  /** tab id used by TablesContainer */
  key: string;
  /** tab label (Persian) */
  label: string;
  filters: PageFilter[];
}

// ─── field accessors ─────────────────────────────────────────────────────────
const title = (r: any): string => r?.title?.[0]?.title || "";
const titleLen = (r: any): number => {
  const explicit = Number(r?.title?.[0]?.title_len);
  return Number.isFinite(explicit) && explicit > 0 ? explicit : title(r).length;
};
const desc = (r: any): string => r?.description || "";
const h1s = (r: any): string[] => r?.headings?.h1 || [];
const h2s = (r: any): string[] => r?.headings?.h2 || [];
const status = (r: any): number => Number(r?.status_code) || 0;
const canonicals = (r: any): string[] => r?.canonicals || [];
const robots = (r: any): string =>
  (r?.meta_robots?.meta_robots || []).join(",").toLowerCase();
const url = (r: any): string => r?.url || "";

/** Normalised comparison so a trailing slash doesn't fake a canonical mismatch. */
function sameUrl(a: string, b: string): boolean {
  const n = (u: string) =>
    String(u || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "")
      .split("#")[0];
  return Boolean(a) && n(a) === n(b);
}

/**
 * Values appearing on more than one page. Built once per call rather than per
 * row — a naive `filter(...).length > 1` inside the predicate would be O(n²)
 * and visibly stall on a large crawl.
 */
function duplicateSet(all: any[], get: (r: any) => string): Set<string> {
  const counts = new Map<string, number>();
  for (const r of all) {
    const v = (get(r) || "").trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const out = new Set<string>();
  for (const [v, n] of counts) if (n > 1) out.add(v);
  return out;
}

// Memoise the duplicate sets per array identity, so all filters in a dropdown
// share one pass instead of rebuilding the map for every filter's count.
const dupCache = new WeakMap<object, Map<string, Set<string>>>();
function cachedDuplicates(
  all: any[],
  name: string,
  get: (r: any) => string,
): Set<string> {
  let perArray = dupCache.get(all as unknown as object);
  if (!perArray) {
    perArray = new Map();
    dupCache.set(all as unknown as object, perArray);
  }
  let set = perArray.get(name);
  if (!set) {
    set = duplicateSet(all, get);
    perArray.set(name, set);
  }
  return set;
}

const ALL: PageFilter = { key: "all", label: "All", match: () => true };

// Only HTML pages belong in the on-page tabs; assets would show as "missing
// title" for every image and drown the real findings.
const isPage = (r: any) =>
  String(r?.content_type || "text/html").includes("html");

export const FILTER_SETS: FilterSet[] = [
  {
    key: "pageTitles",
    label: "Page Titles",
    filters: [
      ALL,
      {
        key: "missing",
        label: "Missing",
        match: (r) => isPage(r) && !title(r).trim(),
      },
      {
        key: "duplicate",
        label: "Duplicate",
        match: (r, all) =>
          isPage(r) && cachedDuplicates(all, "title", title).has(title(r).trim()),
      },
      {
        key: "over60",
        label: "Over 60 Characters",
        match: (r) => isPage(r) && titleLen(r) > 60,
      },
      {
        key: "below30",
        label: "Below 30 Characters",
        match: (r) => isPage(r) && titleLen(r) > 0 && titleLen(r) < 30,
      },
      {
        key: "multiple",
        label: "Multiple",
        match: (r) => isPage(r) && (r?.title?.length || 0) > 1,
      },
      {
        key: "sameAsH1",
        label: "Same as H1",
        match: (r) =>
          isPage(r) &&
          Boolean(title(r).trim()) &&
          title(r).trim() === (h1s(r)[0] || "").trim(),
      },
    ],
  },
  {
    key: "metaDescription",
    label: "Meta Description",
    filters: [
      ALL,
      {
        key: "missing",
        label: "Missing",
        match: (r) => isPage(r) && !desc(r).trim(),
      },
      {
        key: "duplicate",
        label: "Duplicate",
        match: (r, all) =>
          isPage(r) && cachedDuplicates(all, "desc", desc).has(desc(r).trim()),
      },
      {
        key: "over155",
        label: "Over 155 Characters",
        match: (r) => isPage(r) && desc(r).length > 155,
      },
      {
        key: "below70",
        label: "Below 70 Characters",
        match: (r) => isPage(r) && desc(r).length > 0 && desc(r).length < 70,
      },
    ],
  },
  {
    key: "h1Tab",
    label: "H1",
    filters: [
      ALL,
      { key: "missing", label: "Missing", match: (r) => isPage(r) && !h1s(r)[0] },
      {
        key: "duplicate",
        label: "Duplicate",
        match: (r, all) =>
          isPage(r) &&
          cachedDuplicates(all, "h1", (x) => h1s(x)[0] || "").has(
            (h1s(r)[0] || "").trim(),
          ),
      },
      {
        key: "over70",
        label: "Over 70 Characters",
        match: (r) => isPage(r) && (h1s(r)[0] || "").length > 70,
      },
      {
        key: "multiple",
        label: "Multiple",
        match: (r) => isPage(r) && h1s(r).length > 1,
      },
    ],
  },
  {
    key: "h2Tab",
    label: "H2",
    filters: [
      ALL,
      { key: "missing", label: "Missing", match: (r) => isPage(r) && !h2s(r)[0] },
      {
        key: "duplicate",
        label: "Duplicate",
        match: (r, all) =>
          isPage(r) &&
          cachedDuplicates(all, "h2", (x) => h2s(x)[0] || "").has(
            (h2s(r)[0] || "").trim(),
          ),
      },
      {
        key: "over70",
        label: "Over 70 Characters",
        match: (r) => isPage(r) && (h2s(r)[0] || "").length > 70,
      },
      {
        key: "multiple",
        label: "Multiple",
        match: (r) => isPage(r) && h2s(r).length > 1,
      },
    ],
  },
  {
    key: "responseCodes",
    label: "Response Codes",
    filters: [
      ALL,
      { key: "noResponse", label: "No Response", match: (r) => status(r) === 0 },
      {
        key: "success",
        label: "Success (2xx)",
        match: (r) => status(r) >= 200 && status(r) < 300,
      },
      {
        key: "redirect",
        label: "Redirection (3xx)",
        match: (r) => status(r) >= 300 && status(r) < 400,
      },
      {
        key: "clientError",
        label: "Client Error (4xx)",
        match: (r) => status(r) >= 400 && status(r) < 500,
      },
      {
        key: "serverError",
        label: "Server Error (5xx)",
        match: (r) => status(r) >= 500,
      },
    ],
  },
  {
    key: "canonicalsTab",
    label: "Canonicals",
    filters: [
      ALL,
      {
        key: "contains",
        label: "Contains Canonical",
        match: (r) => isPage(r) && canonicals(r).length > 0,
      },
      {
        key: "self",
        label: "Self Referencing",
        match: (r) => isPage(r) && sameUrl(canonicals(r)[0] || "", url(r)),
      },
      {
        key: "canonicalised",
        label: "Canonicalised",
        match: (r) => {
          const c = canonicals(r)[0];
          return isPage(r) && Boolean(c) && !sameUrl(c, url(r));
        },
      },
      {
        key: "missing",
        label: "Missing",
        match: (r) => isPage(r) && canonicals(r).length === 0,
      },
      {
        key: "multiple",
        label: "Multiple",
        match: (r) => isPage(r) && canonicals(r).length > 1,
      },
    ],
  },
  {
    key: "directives",
    label: "Directives",
    filters: [
      ALL,
      { key: "index", label: "Index", match: (r) => robots(r).includes("index") && !robots(r).includes("noindex") },
      { key: "noindex", label: "Noindex", match: (r) => robots(r).includes("noindex") },
      { key: "follow", label: "Follow", match: (r) => robots(r).includes("follow") && !robots(r).includes("nofollow") },
      { key: "nofollow", label: "Nofollow", match: (r) => robots(r).includes("nofollow") },
      { key: "noarchive", label: "NoArchive", match: (r) => robots(r).includes("noarchive") },
      { key: "nosnippet", label: "NoSnippet", match: (r) => robots(r).includes("nosnippet") },
      { key: "none", label: "بدون Meta Robots", match: (r) => isPage(r) && !robots(r) },
    ],
  },
  {
    key: "security",
    label: "Security",
    filters: [
      ALL,
      { key: "http", label: "HTTP URLs", match: (r) => url(r).startsWith("http://") },
      { key: "https", label: "HTTPS URLs", match: (r) => url(r).startsWith("https://") },
      {
        key: "mixed",
        label: "Mixed Content",
        match: (r) => {
          if (!url(r).startsWith("https://")) return false;
          const pools = [r?.images, r?.scripts, r?.css, r?.stylesheets];
          return pools.some(
            (pool) =>
              Array.isArray(pool) &&
              pool.some((item: any) => {
                const u =
                  typeof item === "string" ? item : item?.url || item?.[0];
                return typeof u === "string" && u.startsWith("http://");
              }),
          );
        },
      },
    ],
  },
  {
    key: "contentTab",
    label: "Content",
    filters: [
      ALL,
      {
        key: "lowWord",
        label: "Low Content (< 300 words)",
        match: (r) => {
          const w = Number(r?.word_count);
          return isPage(r) && Number.isFinite(w) && w > 0 && w < 300;
        },
      },
      {
        key: "empty",
        label: "بدون محتوا",
        match: (r) => isPage(r) && !Number(r?.word_count),
      },
      {
        key: "readability",
        label: "خوانایی پایین (Flesch < 30)",
        match: (r) => {
          const f = Number(r?.flesch ?? r?.flesch?.Ok?.[0]);
          return Number.isFinite(f) && f > 0 && f < 30;
        },
      },
    ],
  },
  {
    key: "urlTab",
    label: "URL",
    filters: [
      ALL,
      {
        key: "nonAscii",
        label: "Non ASCII Characters",
        // eslint-disable-next-line no-control-regex
        match: (r) => /[^\x00-\x7F]/.test(decodeURI(url(r) || "")),
      },
      { key: "underscores", label: "Underscores", match: (r) => url(r).includes("_") },
      {
        key: "uppercase",
        label: "Uppercase",
        match: (r) => {
          // Only the path matters; the scheme and host are case-insensitive.
          try {
            const p = new URL(url(r)).pathname;
            return /[A-Z]/.test(p);
          } catch {
            return false;
          }
        },
      },
      {
        key: "multipleSlashes",
        label: "Multiple Slashes",
        match: (r) => /(?<!:)\/\//.test(url(r)),
      },
      { key: "params", label: "Parameters", match: (r) => url(r).includes("?") },
      { key: "over115", label: "Over 115 Characters", match: (r) => url(r).length > 115 },
      { key: "space", label: "Contains Space", match: (r) => /%20|\s/.test(url(r)) },
    ],
  },
  {
    key: "hreflangTab",
    label: "Hreflang",
    filters: [
      ALL,
      {
        key: "contains",
        label: "Contains Hreflang",
        match: (r) => (r?.hreflangs || []).length > 0,
      },
      {
        key: "missing",
        label: "Missing Hreflang",
        match: (r) => isPage(r) && !(r?.hreflangs || []).length,
      },
      {
        key: "noSelf",
        label: "Missing Self Reference",
        match: (r) => {
          const hl = r?.hreflangs || [];
          if (!hl.length) return false;
          return !hl.some((h: any) => sameUrl(h?.url || "", url(r)));
        },
      },
      {
        key: "noXDefault",
        label: "Missing x-default",
        match: (r) => {
          const hl = r?.hreflangs || [];
          if (!hl.length) return false;
          return !hl.some(
            (h: any) => String(h?.code || "").toLowerCase() === "x-default",
          );
        },
      },
    ],
  },
  {
    key: "structuredData",
    label: "Structured Data",
    filters: [
      ALL,
      {
        key: "contains",
        label: "Contains Structured Data",
        match: (r) => Boolean(r?.schema) && r.schema !== "No",
      },
      {
        key: "missing",
        label: "Missing Structured Data",
        match: (r) => isPage(r) && (!r?.schema || r.schema === "No"),
      },
    ],
  },
  {
    key: "imagesTab",
    label: "Images",
    filters: [
      ALL,
      {
        key: "missingAlt",
        label: "Missing Alt Text",
        match: (r) => {
          const pool = Array.isArray(r?.images?.Ok) ? r.images.Ok : r?.images;
          if (!Array.isArray(pool)) return false;
          return pool.some((img: any) => {
            const alt = Array.isArray(img) ? img[1] : img?.alt;
            return !String(alt || "").trim();
          });
        },
      },
      {
        key: "altOver100",
        label: "Alt Text Over 100 Characters",
        match: (r) => {
          const pool = Array.isArray(r?.images?.Ok) ? r.images.Ok : r?.images;
          if (!Array.isArray(pool)) return false;
          return pool.some((img: any) => {
            const alt = Array.isArray(img) ? img[1] : img?.alt;
            return String(alt || "").length > 100;
          });
        },
      },
    ],
  },
  {
    key: "paginationTab",
    label: "Pagination",
    filters: [
      ALL,
      {
        key: "contains",
        label: "Contains Pagination",
        match: (r) => Boolean(r?.pagination?.next || r?.pagination?.prev),
      },
      {
        key: "firstPage",
        label: "First Page",
        // next but no prev — the head of a paginated series.
        match: (r) => Boolean(r?.pagination?.next) && !r?.pagination?.prev,
      },
      {
        key: "lastPage",
        label: "Last Page",
        match: (r) => Boolean(r?.pagination?.prev) && !r?.pagination?.next,
      },
      {
        key: "selfRef",
        label: "Sequence Error (Self Reference)",
        // A page pointing rel=next or rel=prev at itself is a broken template;
        // the series dead-ends there.
        match: (r) =>
          sameUrl(r?.pagination?.next || "", url(r)) ||
          sameUrl(r?.pagination?.prev || "", url(r)),
      },
      {
        key: "nonIndexable",
        label: "Non-Indexable Paginated URL",
        match: (r) =>
          Boolean(r?.pagination?.next || r?.pagination?.prev) &&
          (r?.indexability?.indexability ?? 0.5) < 0.5,
      },
    ],
  },
  {
    key: "ampTab",
    label: "AMP",
    filters: [
      ALL,
      {
        key: "contains",
        label: "Contains AMP Link",
        match: (r) => Boolean(r?.pagination?.amphtml),
      },
      {
        key: "missing",
        label: "Missing AMP Link",
        match: (r) => isPage(r) && !r?.pagination?.amphtml,
      },
    ],
  },
];

export function getFilterSet(key: string): FilterSet | undefined {
  return FILTER_SETS.find((f) => f.key === key);
}