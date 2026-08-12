// Builds Screaming Frog's Overview tree: a Summary block of crawl totals, then
// a "Crawl Data" hierarchy where every SEO element expands into its own
// filter counts with a percentage of the parent total.
//
// The percentages follow SF: Summary rows are a share of all URLs encountered,
// while a filter inside an element is a share of that element's own "All".

export interface OverviewRow {
  key: string;
  label: string;
  urls: number;
  pct: number | null;
  depth: 0 | 1 | 2;
  /** parent group key, used for expand/collapse */
  group?: string;
  /** which table filter to apply when this row is clicked */
  filter?: { tab: string; filter: string };
}

const ct = (r: any) => String(r?.content_type || "").toLowerCase();
const status = (r: any) => Number(r?.status_code) || 0;
const isHtml = (r: any) => ct(r).includes("html") || !ct(r);
const indexable = (r: any) => (r?.indexability?.indexability ?? 0.5) >= 0.5;
const title = (r: any) => r?.title?.[0]?.title || "";
const desc = (r: any) => r?.description || "";
const h1 = (r: any) => r?.headings?.h1?.[0] || "";
const h2 = (r: any) => r?.headings?.h2?.[0] || "";
const canon = (r: any) => r?.canonicals || [];
const robots = (r: any) =>
  (r?.meta_robots?.meta_robots || []).join(",").toLowerCase();

function dupes(rows: any[], get: (r: any) => string): number {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = (get(r) || "").trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let n = 0;
  for (const [, c] of counts) if (c > 1) n += c;
  return n;
}

interface Element {
  key: string;
  label: string;
  filters: { key: string; label: string; count: (rows: any[]) => number }[];
}

const count = (fn: (r: any) => boolean) => (rows: any[]) => rows.filter(fn).length;

const ELEMENTS: Element[] = [
  {
    key: "internal",
    label: "Internal",
    filters: [
      { key: "all", label: "All", count: (r) => r.length },
      { key: "html", label: "HTML", count: count((r) => ct(r).includes("html")) },
      {
        key: "javascript",
        label: "JavaScript",
        count: count((r) => ct(r).includes("javascript")),
      },
      { key: "css", label: "CSS", count: count((r) => ct(r).includes("css")) },
      { key: "images", label: "Images", count: count((r) => ct(r).startsWith("image")) },
      {
        key: "media",
        label: "Media",
        count: count((r) => ct(r).startsWith("video") || ct(r).startsWith("audio")),
      },
      { key: "fonts", label: "Fonts", count: count((r) => ct(r).includes("font")) },
      { key: "xml", label: "XML", count: count((r) => ct(r).includes("xml")) },
      { key: "pdf", label: "PDF", count: count((r) => ct(r).includes("pdf")) },
      {
        key: "other",
        label: "Other",
        count: count((r) => {
          const t = ct(r);
          if (!t) return true;
          return !["html", "javascript", "css", "image", "video", "audio", "font", "xml", "pdf"].some(
            (k) => t.includes(k),
          );
        }),
      },
    ],
  },
  {
    key: "responseCodes",
    label: "Response Codes",
    filters: [
      { key: "all", label: "All", count: (r) => r.length },
      { key: "noResponse", label: "No Response", count: count((r) => status(r) === 0) },
      { key: "success", label: "Success (2xx)", count: count((r) => status(r) >= 200 && status(r) < 300) },
      { key: "redirect", label: "Redirection (3xx)", count: count((r) => status(r) >= 300 && status(r) < 400) },
      { key: "clientError", label: "Client Error (4xx)", count: count((r) => status(r) >= 400 && status(r) < 500) },
      { key: "serverError", label: "Server Error (5xx)", count: count((r) => status(r) >= 500) },
    ],
  },
  {
    key: "pageTitles",
    label: "Page Titles",
    filters: [
      { key: "all", label: "All", count: count(isHtml) },
      { key: "missing", label: "Missing", count: count((r) => isHtml(r) && !title(r).trim()) },
      { key: "duplicate", label: "Duplicate", count: (rows) => dupes(rows.filter(isHtml), title) },
      { key: "over60", label: "Over 60 Characters", count: count((r) => isHtml(r) && title(r).length > 60) },
      { key: "below30", label: "Below 30 Characters", count: count((r) => isHtml(r) && title(r).length > 0 && title(r).length < 30) },
    ],
  },
  {
    key: "metaDescription",
    label: "Meta Description",
    filters: [
      { key: "all", label: "All", count: count(isHtml) },
      { key: "missing", label: "Missing", count: count((r) => isHtml(r) && !desc(r).trim()) },
      { key: "duplicate", label: "Duplicate", count: (rows) => dupes(rows.filter(isHtml), desc) },
      { key: "over155", label: "Over 155 Characters", count: count((r) => isHtml(r) && desc(r).length > 155) },
      { key: "below70", label: "Below 70 Characters", count: count((r) => isHtml(r) && desc(r).length > 0 && desc(r).length < 70) },
    ],
  },
  {
    key: "h1Tab",
    label: "H1",
    filters: [
      { key: "all", label: "All", count: count(isHtml) },
      { key: "missing", label: "Missing", count: count((r) => isHtml(r) && !h1(r)) },
      { key: "duplicate", label: "Duplicate", count: (rows) => dupes(rows.filter(isHtml), h1) },
      { key: "over70", label: "Over 70 Characters", count: count((r) => isHtml(r) && h1(r).length > 70) },
      { key: "multiple", label: "Multiple", count: count((r) => isHtml(r) && (r?.headings?.h1?.length || 0) > 1) },
    ],
  },
  {
    key: "h2Tab",
    label: "H2",
    filters: [
      { key: "all", label: "All", count: count(isHtml) },
      { key: "missing", label: "Missing", count: count((r) => isHtml(r) && !h2(r)) },
      { key: "duplicate", label: "Duplicate", count: (rows) => dupes(rows.filter(isHtml), h2) },
      { key: "multiple", label: "Multiple", count: count((r) => isHtml(r) && (r?.headings?.h2?.length || 0) > 1) },
    ],
  },
  {
    key: "contentTab",
    label: "Content",
    filters: [
      { key: "all", label: "All", count: count(isHtml) },
      { key: "lowWord", label: "Low Content Pages", count: count((r) => { const w = Number(r?.word_count); return isHtml(r) && w > 0 && w < 300; }) },
      { key: "empty", label: "بدون محتوا", count: count((r) => isHtml(r) && !Number(r?.word_count)) },
    ],
  },
  {
    key: "canonicalsTab",
    label: "Canonicals",
    filters: [
      { key: "all", label: "All", count: count(isHtml) },
      { key: "contains", label: "Contains Canonical", count: count((r) => isHtml(r) && canon(r).length > 0) },
      { key: "missing", label: "Missing", count: count((r) => isHtml(r) && canon(r).length === 0) },
      { key: "multiple", label: "Multiple", count: count((r) => isHtml(r) && canon(r).length > 1) },
    ],
  },
  {
    key: "directives",
    label: "Directives",
    filters: [
      { key: "all", label: "All", count: count(isHtml) },
      { key: "noindex", label: "Noindex", count: count((r) => robots(r).includes("noindex")) },
      { key: "nofollow", label: "Nofollow", count: count((r) => robots(r).includes("nofollow")) },
      { key: "none", label: "بدون Meta Robots", count: count((r) => isHtml(r) && !robots(r)) },
    ],
  },
  {
    key: "security",
    label: "Security",
    filters: [
      { key: "all", label: "All", count: (r) => r.length },
      { key: "http", label: "HTTP URLs", count: count((r) => String(r?.url || "").startsWith("http://")) },
      { key: "https", label: "HTTPS URLs", count: count((r) => String(r?.url || "").startsWith("https://")) },
    ],
  },
  {
    key: "urlTab",
    label: "URL",
    filters: [
      { key: "all", label: "All", count: (r) => r.length },
      {
        key: "nonAscii",
        label: "Non ASCII Characters",
        count: count((r) => {
          try {
            return /[^\x00-\x7F]/.test(decodeURI(r?.url || ""));
          } catch {
            return false;
          }
        }),
      },
      { key: "underscores", label: "Underscores", count: count((r) => String(r?.url || "").includes("_")) },
      { key: "params", label: "Parameters", count: count((r) => String(r?.url || "").includes("?")) },
      { key: "over115", label: "Over 115 Characters", count: count((r) => String(r?.url || "").length > 115) },
    ],
  },
  {
    key: "hreflangTab",
    label: "Hreflang",
    filters: [
      { key: "all", label: "All", count: count(isHtml) },
      { key: "contains", label: "Contains Hreflang", count: count((r) => (r?.hreflangs || []).length > 0) },
      { key: "missing", label: "Missing Hreflang", count: count((r) => isHtml(r) && !(r?.hreflangs || []).length) },
    ],
  },
  {
    key: "structuredData",
    label: "Structured Data",
    filters: [
      { key: "all", label: "All", count: count(isHtml) },
      { key: "contains", label: "Contains Structured Data", count: count((r) => Boolean(r?.schema) && r.schema !== "No") },
      { key: "missing", label: "Missing Structured Data", count: count((r) => isHtml(r) && (!r?.schema || r.schema === "No")) },
    ],
  },
];


/**
 * Display order of the Crawl Data tree, matching Screaming Frog exactly.
 * Elements not in this list fall to the end; elements listed but not built
 * are simply absent, so the order survives adding new ones later.
 */
const CRAWL_DATA_ORDER = [
  "internal",
  "external",
  "security",
  "responseCodes",
  "urlTab",
  "pageTitles",
  "metaDescription",
  "metaKeywords",
  "h1Tab",
  "h2Tab",
  "contentTab",
  "imagesTab",
  "canonicalsTab",
  "paginationTab",
  "directives",
  "hreflangTab",
  "javascriptTab",
  "linksTab",
  "ampTab",
  "structuredData",
  "sitemapsTab",
];

function pct(n: number, total: number): number | null {
  if (!total) return null;
  return (n / total) * 100;
}

export function buildOverview(rows: any[]): {
  summary: OverviewRow[];
  elements: { key: string; label: string; all: number; children: OverviewRow[] }[];
} {
  const all = rows || [];
  const total = all.length;

  const internalIndexable = all.filter((r) => isHtml(r) && indexable(r)).length;
  const internalNonIndexable = all.filter((r) => isHtml(r) && !indexable(r)).length;

  const summary: OverviewRow[] = [
    { key: "encountered", label: "Total URLs Encountered", urls: total, pct: 100, depth: 1 },
    { key: "crawled", label: "Total URLs Crawled", urls: total, pct: 100, depth: 1 },
    { key: "internal", label: "Total Internal URLs", urls: total, pct: 100, depth: 1 },
    {
      key: "indexable",
      label: "Total Internal Indexable URLs",
      urls: internalIndexable,
      pct: pct(internalIndexable, total),
      depth: 1,
    },
    {
      key: "nonIndexable",
      label: "Total Internal Non-Indexable URLs",
      urls: internalNonIndexable,
      pct: pct(internalNonIndexable, total),
      depth: 1,
    },
  ];

  const ordered = [...ELEMENTS].sort((a, b) => {
    const ia = CRAWL_DATA_ORDER.indexOf(a.key);
    const ib = CRAWL_DATA_ORDER.indexOf(b.key);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const elements = ordered.map((el) => {
    const allCount = el.filters[0].count(all);
    return {
      key: el.key,
      label: el.label,
      all: allCount,
      children: el.filters.map((f) => {
        const n = f.count(all);
        return {
          key: `${el.key}.${f.key}`,
          label: f.label,
          urls: n,
          pct: pct(n, allCount),
          depth: 2 as const,
          group: el.key,
          filter: { tab: el.key, filter: f.key },
        };
      }),
    };
  });

  return { summary, elements };
}
