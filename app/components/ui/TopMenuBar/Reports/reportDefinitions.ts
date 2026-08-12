// Screaming Frog's Reports menu.
//
// Each report is a named slice of the crawl with its own column set, exported
// as CSV. These are the ones that answer a question the tabbed views can't:
// "which redirects chain", "what is orphaned", "where is insecure content".

export interface ReportColumn {
  header: string;
  value: (row: any, all: any[]) => any;
}

export interface ReportDefinition {
  key: string;
  /** menu label, kept in English to match Screaming Frog */
  label: string;
  /** one-line explanation shown in the menu */
  hint: string;
  columns: ReportColumn[];
  select: (all: any[], extra: ReportExtra) => any[];
}

export interface ReportExtra {
  /** URLs declared in the sitemap, for the orphan report */
  sitemapUrls?: string[];
}

const status = (r: any) => Number(r?.status_code) || 0;
const title = (r: any) => r?.title?.[0]?.title || "";
const desc = (r: any) => r?.description || "";
const url = (r: any) => r?.url || "";

const norm = (u: string) =>
  String(u || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .split("#")[0];

const COL_ADDRESS: ReportColumn = { header: "Address", value: (r) => url(r) };
const COL_STATUS: ReportColumn = { header: "Status Code", value: (r) => status(r) || "" };
const COL_INDEXABILITY: ReportColumn = {
  header: "Indexability",
  value: (r) => ((r?.indexability?.indexability ?? 0.5) >= 0.5 ? "Indexable" : "Non-Indexable"),
};

function duplicateGroups(all: any[], get: (r: any) => string): Map<string, any[]> {
  const groups = new Map<string, any[]>();
  for (const r of all) {
    const v = (get(r) || "").trim();
    if (!v) continue;
    const list = groups.get(v) || [];
    list.push(r);
    groups.set(v, list);
  }
  for (const [k, v] of Array.from(groups)) if (v.length < 2) groups.delete(k);
  return groups;
}

export const REPORTS: ReportDefinition[] = [
  {
    key: "crawlOverview",
    label: "Crawl Overview",
    hint: "خلاصه‌ی کل کراول: تعداد، وضعیت‌ها، قابلیت ایندکس",
    columns: [
      { header: "Metric", value: (r) => r.metric },
      { header: "Value", value: (r) => r.value },
    ],
    select: (all) => {
      const n = all.length || 1;
      const by = (fn: (r: any) => boolean) => all.filter(fn).length;
      return [
        { metric: "Total URLs Crawled", value: all.length },
        { metric: "Success (2xx)", value: by((r) => status(r) >= 200 && status(r) < 300) },
        { metric: "Redirection (3xx)", value: by((r) => status(r) >= 300 && status(r) < 400) },
        { metric: "Client Error (4xx)", value: by((r) => status(r) >= 400 && status(r) < 500) },
        { metric: "Server Error (5xx)", value: by((r) => status(r) >= 500) },
        { metric: "Indexable", value: by((r) => (r?.indexability?.indexability ?? 0.5) >= 0.5) },
        { metric: "Non-Indexable", value: by((r) => (r?.indexability?.indexability ?? 0.5) < 0.5) },
        { metric: "Missing Title", value: by((r) => !title(r).trim()) },
        { metric: "Missing Meta Description", value: by((r) => !desc(r).trim()) },
        { metric: "Missing H1", value: by((r) => !(r?.headings?.h1?.[0] || "").trim()) },
        {
          metric: "Average Word Count",
          value: Math.round(all.reduce((s, r) => s + (Number(r?.word_count) || 0), 0) / n),
        },
      ];
    },
  },
  {
    key: "redirects",
    label: "Redirects",
    hint: "هر URL که ریدایرکت می‌شود، با مقصدش",
    columns: [
      COL_ADDRESS,
      COL_STATUS,
      { header: "Redirect URL", value: (r) => r?.redirect_url || "" },
      { header: "Redirect Type", value: (r) => r?.redirection_type || "" },
    ],
    select: (all) => all.filter((r) => status(r) >= 300 && status(r) < 400),
  },
  {
    key: "insecureContent",
    label: "Insecure Content",
    hint: "صفحات HTTPS که منابع HTTP بارگذاری می‌کنند",
    columns: [
      COL_ADDRESS,
      { header: "Insecure Resource", value: (r) => r.__insecure },
    ],
    select: (all) => {
      const out: any[] = [];
      for (const r of all) {
        if (!url(r).startsWith("https://")) continue;
        for (const pool of [r?.images, r?.scripts, r?.css, r?.stylesheets]) {
          if (!Array.isArray(pool)) continue;
          for (const item of pool) {
            const u = typeof item === "string" ? item : item?.url || item?.[0];
            if (typeof u === "string" && u.startsWith("http://")) {
              out.push({ ...r, __insecure: u });
            }
          }
        }
      }
      return out;
    },
  },
  {
    key: "orphanPages",
    label: "Orphan Pages",
    hint: "در سایت‌مپ هست ولی کراول به آن نرسید",
    columns: [{ header: "Address", value: (r) => r.address }],
    select: (all, extra) => {
      const crawled = new Set(all.map((r) => norm(url(r))));
      return (extra?.sitemapUrls || [])
        .filter((u) => !crawled.has(norm(u)))
        .map((u) => ({ address: u }));
    },
  },
  {
    key: "duplicateTitles",
    label: "Duplicate Page Titles",
    hint: "صفحاتی که Title یکسان دارند، گروه‌بندی‌شده",
    columns: [
      COL_ADDRESS,
      { header: "Title", value: (r) => title(r) },
      { header: "Occurrences", value: (r) => r.__count },
    ],
    select: (all) => {
      const out: any[] = [];
      for (const [, group] of duplicateGroups(all, title)) {
        for (const r of group) out.push({ ...r, __count: group.length });
      }
      return out;
    },
  },
  {
    key: "duplicateDescriptions",
    label: "Duplicate Meta Descriptions",
    hint: "صفحاتی که Meta Description یکسان دارند",
    columns: [
      COL_ADDRESS,
      { header: "Meta Description", value: (r) => desc(r) },
      { header: "Occurrences", value: (r) => r.__count },
    ],
    select: (all) => {
      const out: any[] = [];
      for (const [, group] of duplicateGroups(all, desc)) {
        for (const r of group) out.push({ ...r, __count: group.length });
      }
      return out;
    },
  },
  {
    key: "canonicalErrors",
    label: "Canonical Errors",
    hint: "صفحاتی که canonical ندارند یا به جای دیگری canonical شده‌اند",
    columns: [
      COL_ADDRESS,
      { header: "Canonical", value: (r) => (r?.canonicals || [])[0] || "" },
      { header: "Issue", value: (r) => r.__issue },
      COL_INDEXABILITY,
    ],
    select: (all) => {
      const out: any[] = [];
      for (const r of all) {
        if (!String(r?.content_type || "text/html").includes("html")) continue;
        const c = (r?.canonicals || [])[0];
        if (!c) out.push({ ...r, __issue: "Missing canonical" });
        else if (norm(c) !== norm(url(r)))
          out.push({ ...r, __issue: "Canonicalised to another URL" });
        if ((r?.canonicals || []).length > 1)
          out.push({ ...r, __issue: "Multiple canonicals" });
      }
      return out;
    },
  },
  {
    key: "serpSummary",
    label: "SERP Summary",
    hint: "Title و Description با طول کاراکتر، برای بازبینی انبوه",
    columns: [
      COL_ADDRESS,
      { header: "Title", value: (r) => title(r) },
      { header: "Title Length", value: (r) => title(r).length || "" },
      { header: "Meta Description", value: (r) => desc(r) },
      { header: "Meta Description Length", value: (r) => desc(r).length || "" },
    ],
    select: (all) =>
      all.filter((r) => String(r?.content_type || "text/html").includes("html")),
  },
  {
    key: "nonIndexable",
    label: "Non-Indexable URLs",
    hint: "هر صفحه‌ای که موتور جستجو ایندکسش نمی‌کند، با دلیلش",
    columns: [
      COL_ADDRESS,
      COL_STATUS,
      { header: "Reason", value: (r) => r?.indexability?.indexability_reason || "" },
    ],
    select: (all) => all.filter((r) => (r?.indexability?.indexability ?? 0.5) < 0.5),
  },
  {
    key: "responseCodes",
    label: "Response Codes",
    hint: "همه‌ی URLها با کد و متن وضعیت",
    columns: [COL_ADDRESS, COL_STATUS, COL_INDEXABILITY],
    select: (all) => all,
  },
];
