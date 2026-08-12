// Screaming Frog's Bulk Export menu.
//
// Where Reports answer a specific question, Bulk Export dumps a whole slice of
// the crawl for working on elsewhere — a spreadsheet of every image missing alt
// text, every noindex page, every internal link. Grouped exactly like SF's
// nested menu.

export interface ExportColumn {
  header: string;
  value: (row: any) => any;
}

export interface ExportItem {
  key: string;
  label: string;
  columns: ExportColumn[];
  select: (all: any[]) => any[];
}

export interface ExportGroup {
  label: string;
  items: ExportItem[];
}

const status = (r: any) => Number(r?.status_code) || 0;
const url = (r: any) => r?.url || "";
const title = (r: any) => r?.title?.[0]?.title || "";
const desc = (r: any) => r?.description || "";
const robots = (r: any) =>
  (r?.meta_robots?.meta_robots || []).join(",").toLowerCase();
const isHtml = (r: any) => String(r?.content_type || "text/html").includes("html");

const ADDRESS: ExportColumn = { header: "Address", value: url };
const STATUS: ExportColumn = { header: "Status Code", value: (r) => status(r) || "" };

/** Flattens each page's links into one row per link, as SF's link exports do. */
function explodeLinks(all: any[], pick: (r: any) => any[], type: string) {
  const out: any[] = [];
  for (const r of all) {
    for (const link of pick(r) || []) {
      const target =
        typeof link === "string" ? link : link?.url || link?.href || link?.link;
      if (!target) continue;
      out.push({
        __from: url(r),
        __to: target,
        __anchor: typeof link === "string" ? "" : link?.anchor_text || link?.anchor || "",
        __type: type,
        __status: typeof link === "string" ? "" : link?.status ?? "",
      });
    }
  }
  return out;
}

const LINK_COLUMNS: ExportColumn[] = [
  { header: "Type", value: (r) => r.__type },
  { header: "From", value: (r) => r.__from },
  { header: "To", value: (r) => r.__to },
  { header: "Anchor Text", value: (r) => r.__anchor },
  { header: "Status Code", value: (r) => r.__status },
];

export const BULK_EXPORTS: ExportGroup[] = [
  {
    label: "Links",
    items: [
      {
        key: "all-inlinks",
        label: "All Inlinks",
        columns: LINK_COLUMNS,
        select: (all) => explodeLinks(all, (r) => r?.inlinks || [], "Inlink"),
      },
      {
        key: "all-outlinks",
        label: "All Outlinks",
        columns: LINK_COLUMNS,
        select: (all) =>
          explodeLinks(all, (r) => r?.outlinks || r?.internal_links || [], "Outlink"),
      },
      {
        key: "external-links",
        label: "External Links",
        columns: LINK_COLUMNS,
        select: (all) =>
          explodeLinks(all, (r) => r?.external_links || [], "External"),
      },
    ],
  },
  {
    label: "Response Codes",
    items: [
      {
        key: "rc-3xx",
        label: "Redirection (3xx)",
        columns: [ADDRESS, STATUS, { header: "Redirect URL", value: (r) => r?.redirect_url || "" }],
        select: (all) => all.filter((r) => status(r) >= 300 && status(r) < 400),
      },
      {
        key: "rc-4xx",
        label: "Client Error (4xx)",
        columns: [ADDRESS, STATUS],
        select: (all) => all.filter((r) => status(r) >= 400 && status(r) < 500),
      },
      {
        key: "rc-5xx",
        label: "Server Error (5xx)",
        columns: [ADDRESS, STATUS],
        select: (all) => all.filter((r) => status(r) >= 500),
      },
      {
        key: "rc-no-response",
        label: "No Response",
        columns: [ADDRESS],
        select: (all) => all.filter((r) => status(r) === 0),
      },
    ],
  },
  {
    label: "Content",
    items: [
      {
        key: "low-content",
        label: "Low Content Pages",
        columns: [ADDRESS, { header: "Word Count", value: (r) => r?.word_count ?? "" }],
        select: (all) =>
          all.filter((r) => {
            const w = Number(r?.word_count);
            return isHtml(r) && w > 0 && w < 300;
          }),
      },
      {
        key: "duplicate-titles",
        label: "Duplicate Titles",
        columns: [ADDRESS, { header: "Title", value: title }],
        select: (all) => {
          const counts = new Map<string, number>();
          for (const r of all) {
            const t = title(r).trim();
            if (t) counts.set(t, (counts.get(t) || 0) + 1);
          }
          return all.filter((r) => (counts.get(title(r).trim()) || 0) > 1);
        },
      },
      {
        key: "missing-titles",
        label: "Missing Titles",
        columns: [ADDRESS],
        select: (all) => all.filter((r) => isHtml(r) && !title(r).trim()),
      },
      {
        key: "missing-descriptions",
        label: "Missing Meta Descriptions",
        columns: [ADDRESS],
        select: (all) => all.filter((r) => isHtml(r) && !desc(r).trim()),
      },
      {
        key: "missing-h1",
        label: "Missing H1",
        columns: [ADDRESS],
        select: (all) =>
          all.filter((r) => isHtml(r) && !(r?.headings?.h1?.[0] || "").trim()),
      },
    ],
  },
  {
    label: "Images",
    items: [
      {
        key: "all-images",
        label: "All Images",
        columns: [
          { header: "Image", value: (r) => r.__img },
          { header: "Found On", value: (r) => r.__page },
          { header: "Alt Text", value: (r) => r.__alt },
        ],
        select: (all) => {
          const out: any[] = [];
          for (const r of all) {
            const pool = Array.isArray(r?.images?.Ok) ? r.images.Ok : r?.images;
            if (!Array.isArray(pool)) continue;
            for (const img of pool) {
              const src = Array.isArray(img) ? img[0] : img?.url || img?.src;
              if (!src) continue;
              out.push({
                __img: src,
                __page: url(r),
                __alt: Array.isArray(img) ? img[1] || "" : img?.alt || "",
              });
            }
          }
          return out;
        },
      },
      {
        key: "images-missing-alt",
        label: "Images Missing Alt Text",
        columns: [
          { header: "Image", value: (r) => r.__img },
          { header: "Found On", value: (r) => r.__page },
        ],
        select: (all) => {
          const out: any[] = [];
          for (const r of all) {
            const pool = Array.isArray(r?.images?.Ok) ? r.images.Ok : r?.images;
            if (!Array.isArray(pool)) continue;
            for (const img of pool) {
              const src = Array.isArray(img) ? img[0] : img?.url || img?.src;
              const alt = Array.isArray(img) ? img[1] : img?.alt;
              if (src && !String(alt || "").trim()) {
                out.push({ __img: src, __page: url(r) });
              }
            }
          }
          return out;
        },
      },
    ],
  },
  {
    label: "Directives",
    items: [
      {
        key: "noindex",
        label: "Noindex Pages",
        columns: [ADDRESS, { header: "Meta Robots", value: (r) => robots(r) }],
        select: (all) => all.filter((r) => robots(r).includes("noindex")),
      },
      {
        key: "nofollow",
        label: "Nofollow Pages",
        columns: [ADDRESS, { header: "Meta Robots", value: (r) => robots(r) }],
        select: (all) => all.filter((r) => robots(r).includes("nofollow")),
      },
    ],
  },
  {
    label: "Canonicals",
    items: [
      {
        key: "canonicalised",
        label: "Canonicalised",
        columns: [
          ADDRESS,
          { header: "Canonical", value: (r) => (r?.canonicals || [])[0] || "" },
        ],
        select: (all) => {
          const norm = (u: string) =>
            String(u || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
          return all.filter((r) => {
            const c = (r?.canonicals || [])[0];
            return c && norm(c) !== norm(url(r));
          });
        },
      },
      {
        key: "missing-canonical",
        label: "Missing Canonical",
        columns: [ADDRESS],
        select: (all) => all.filter((r) => isHtml(r) && !(r?.canonicals || []).length),
      },
    ],
  },
  {
    label: "Security",
    items: [
      {
        key: "http-urls",
        label: "HTTP URLs",
        columns: [ADDRESS, STATUS],
        select: (all) => all.filter((r) => url(r).startsWith("http://")),
      },
      {
        key: "https-urls",
        label: "HTTPS URLs",
        columns: [ADDRESS, STATUS],
        select: (all) => all.filter((r) => url(r).startsWith("https://")),
      },
    ],
  },
  {
    label: "Web",
    items: [
      {
        key: "all-urls",
        label: "All URLs (کامل)",
        columns: [
          ADDRESS,
          { header: "Content Type", value: (r) => r?.content_type || "" },
          STATUS,
          {
            header: "Indexability",
            value: (r) =>
              (r?.indexability?.indexability ?? 0.5) >= 0.5 ? "Indexable" : "Non-Indexable",
          },
          { header: "Title", value: title },
          { header: "Meta Description", value: desc },
          { header: "H1", value: (r) => r?.headings?.h1?.[0] || "" },
          { header: "Word Count", value: (r) => r?.word_count ?? "" },
          { header: "Crawl Depth", value: (r) => r?.url_depth ?? "" },
          { header: "Link Score", value: (r) => r?.link_score ?? "" },
        ],
        select: (all) => all,
      },
    ],
  },
];
