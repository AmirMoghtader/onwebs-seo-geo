// Maps each dashboard action-plan issue to the pages that actually have it.
//
// The action plan's counts come from the stored per-crawl summary, which holds
// totals but not the URLs behind them. To answer "which pages exactly?" we
// re-run the same condition over the live crawl rows, so the drawer can list
// the offending URLs instead of only telling the user a number.

export interface AffectedPage {
  url: string;
  detail: string;
}

type Predicate = (row: any, all: any[]) => boolean;
/** Optional second column shown next to the URL, for context. */
type Detail = (row: any) => string;

const status = (r: any) => Number(r?.status_code) || 0;
const title = (r: any) => r?.title?.[0]?.title || "";
const desc = (r: any) => r?.description || "";

function duplicatesOf(all: any[], get: (r: any) => string): Set<string> {
  const counts = new Map<string, number>();
  for (const r of all) {
    const v = (get(r) || "").trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const dupes = new Set<string>();
  for (const [v, n] of counts) if (n > 1) dupes.add(v);
  return dupes;
}

const RULES: Record<string, { match: Predicate; detail?: Detail }> = {
  "5xx": {
    match: (r) => status(r) >= 500,
    detail: (r) => `HTTP ${status(r)}`,
  },
  "4xx": {
    match: (r) => status(r) >= 400 && status(r) < 500,
    detail: (r) => `HTTP ${status(r)}`,
  },
  redirects: {
    match: (r) => status(r) >= 300 && status(r) < 400,
    detail: (r) => `HTTP ${status(r)}`,
  },
  errors: {
    match: (r) => status(r) === 0 || status(r) >= 400,
    detail: (r) => (status(r) ? `HTTP ${status(r)}` : "بدون پاسخ"),
  },
  missing_title: {
    match: (r) => !title(r).trim(),
  },
  dup_title: {
    match: (r, all) => duplicatesOf(all, title).has(title(r).trim()),
    detail: (r) => title(r),
  },
  missing_desc: {
    match: (r) => !desc(r).trim(),
  },
  dup_desc: {
    match: (r, all) => duplicatesOf(all, desc).has(desc(r).trim()),
    detail: (r) => desc(r).slice(0, 90),
  },
  missing_h1: {
    match: (r) => !(r?.headings?.h1?.[0] || "").trim(),
  },
  not_indexable: {
    match: (r) => (r?.indexability?.indexability ?? 0.5) < 0.5,
    detail: (r) => r?.indexability?.indexability_reason || "",
  },
  thin: {
    match: (r) => {
      const w = Number(r?.word_count);
      return Number.isFinite(w) && w > 0 && w < 300;
    },
    detail: (r) => `${r?.word_count} کلمه`,
  },
  canonical: {
    match: (r) => {
      const c = r?.canonicals?.[0] || r?.canonical || "";
      return !c;
    },
  },
  nomobile: {
    match: (r) => r?.mobile === false,
  },
  nohttps: {
    match: (r) => String(r?.url || "").startsWith("http://"),
  },
  mixed: {
    // A https page that pulls at least one http subresource.
    match: (r) => {
      if (!String(r?.url || "").startsWith("https://")) return false;
      const pools = [r?.images, r?.scripts, r?.css, r?.stylesheets];
      return pools.some(
        (pool) =>
          Array.isArray(pool) &&
          pool.some((item: any) => {
            const u = typeof item === "string" ? item : item?.url || item?.[0];
            return typeof u === "string" && u.startsWith("http://");
          }),
      );
    },
  },
};

export function resolveAffectedPages(
  issueKey: string,
  crawlData: any[],
): AffectedPage[] {
  const rule = RULES[issueKey];
  if (!rule || !Array.isArray(crawlData)) return [];

  const out: AffectedPage[] = [];
  for (const row of crawlData) {
    if (!row?.url) continue;
    let hit = false;
    try {
      hit = rule.match(row, crawlData);
    } catch {
      hit = false;
    }
    if (!hit) continue;
    out.push({
      url: row.url,
      detail: rule.detail ? rule.detail(row) || "" : "",
    });
  }
  return out;
}

/** True when we know how to list URLs for this issue, so the UI can hide the affordance otherwise. */
export function canResolve(issueKey: string): boolean {
  return Boolean(RULES[issueKey]);
}
