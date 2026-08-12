// @ts-nocheck
"use client";

// Sitemap review, modelled on Screaming Frog's Sitemaps tab.
//
// The value here is the DIFF, not the file dump the panel used to show: what a
// sitemap declares versus what the crawl actually reached. That difference is
// where the real problems live — orphan URLs nothing links to, pages missing
// from the sitemap entirely, and non-indexable URLs a sitemap should never
// have advertised in the first place.
//
// A bucket is a selection, not a report: picking one narrows the main Internal
// table to exactly those rows, where the full column set, sorting and export
// already live. This panel only ever shows the counts.

import React, { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ExternalLink, Copy, Search } from "lucide-react";
import { toast } from "sonner";
import useGlobalCrawlStore from "@/store/GlobalCrawlDataStore";
import openBrowserWindow from "@/app/Hooks/OpenBrowserWindow";

/** Compare on a canonical form so a trailing slash or scheme never fakes a mismatch. */
function normalize(u: string): string {
  if (!u) return "";
  try {
    let s = decodeURI(String(u).trim().toLowerCase());
    s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
    s = s.split("#")[0];
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return String(u).toLowerCase();
  }
}

// `inTable` marks the buckets whose URLs the crawl actually reached, and so
// have a row in the main table to point at. Orphans are by definition the ones
// it never reached: this panel is the only place they exist.
const BUCKETS = [
  { key: "inSitemap", label: "در سایت‌مپ و کراول‌شده", tone: "text-emerald-500", inTable: true },
  { key: "orphan", label: "در سایت‌مپ ولی کراول نشده", tone: "text-amber-500", inTable: false },
  { key: "missing", label: "کراول‌شده ولی در سایت‌مپ نیست", tone: "text-sky-500", inTable: true },
  { key: "nonIndexable", label: "غیرقابل ایندکس در سایت‌مپ", tone: "text-rose-500", inTable: true },
  { key: "errors", label: "خطادار در سایت‌مپ (4xx/5xx)", tone: "text-rose-600", inTable: true },
];

const SitemapReview = () => {
  const crawlData = useGlobalCrawlStore((s) => s.crawlData);
  const tableFilter = useGlobalCrawlStore((s) => s.tableFilter);
  const setTableFilter = useGlobalCrawlStore(
    (s) => s.actions.ui.setTableFilter,
  );
  const setTableUrlFilter = useGlobalCrawlStore(
    (s) => s.actions.ui.setTableUrlFilter,
  );
  const setDeepCrawlTab = useGlobalCrawlStore(
    (s) => s.actions.ui.setDeepCrawlTab,
  );
  const [declared, setDeclared] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const p = listen("sitemap_urls", (event: any) => {
      setDeclared(Array.isArray(event.payload) ? event.payload : []);
    });
    return () => {
      p.then((f) => f());
    };
  }, []);

  const buckets = useMemo(() => {
    const rows = crawlData || [];
    const crawledByNorm = new Map<string, any>();
    for (const r of rows) {
      if (r?.url) crawledByNorm.set(normalize(r.url), r);
    }
    const declaredNorm = new Map<string, string>();
    for (const u of declared) declaredNorm.set(normalize(u), u);

    const inSitemap: any[] = [];
    const orphan: any[] = [];
    const nonIndexable: any[] = [];
    const errors: any[] = [];

    for (const [norm, original] of declaredNorm) {
      const row = crawledByNorm.get(norm);
      if (!row) {
        // Declared in the sitemap but the crawl never reached it — nothing
        // internal links to it, or it is unreachable.
        orphan.push({ url: original, detail: "" });
        continue;
      }
      const status = Number(row.status_code) || 0;
      const indexable = (row?.indexability?.indexability ?? 0.5) >= 0.5;

      inSitemap.push({ url: row.url, detail: status ? `HTTP ${status}` : "" });
      if (status >= 400) {
        errors.push({ url: row.url, detail: `HTTP ${status}` });
      } else if (!indexable) {
        nonIndexable.push({
          url: row.url,
          detail: row?.indexability?.indexability_reason || "غیرقابل ایندکس",
        });
      }
    }

    const missing: any[] = [];
    for (const [norm, row] of crawledByNorm) {
      if (declaredNorm.has(norm)) continue;
      // Only pages belong in a sitemap; assets and redirects do not.
      const status = Number(row.status_code) || 0;
      if (status >= 300) continue;
      if ((row?.indexability?.indexability ?? 0.5) < 0.5) continue;
      missing.push({ url: row.url, detail: "" });
    }

    return { inSitemap, orphan, missing, nonIndexable, errors };
  }, [crawlData, declared]);

  const activeBucket = BUCKETS.find((b) => b.key === active) || null;
  const rows = (active && buckets[active]) || [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.url.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  // The table's own "حذف فیلتر" button can drop the selection, so the
  // highlight here follows the store rather than drifting out of step with it.
  useEffect(() => {
    if (!activeBucket?.inTable) return;
    if (tableFilter?.kind !== `sitemap:${activeBucket.key}`) setActive(null);
  }, [tableFilter, activeBucket]);

  const selectBucket = (bucket: (typeof BUCKETS)[number]) => {
    const picked = buckets[bucket.key] || [];
    if (!picked.length) return;

    if (active === bucket.key) {
      setActive(null);
      if (bucket.inTable) setTableFilter(null);
      return;
    }

    setActive(bucket.key);
    if (!bucket.inTable) {
      setTableFilter(null);
      return;
    }

    setDeepCrawlTab("internal");
    setTableFilter({
      kind: `sitemap:${bucket.key}`,
      label: `سایت‌مپ › ${bucket.label}`,
    });
    // After the rule, never before: setTableFilter drops any URL set in place.
    setTableUrlFilter(picked.map((r) => r.url));
  };

  const copyAll = () => {
    navigator.clipboard.writeText(filtered.map((r) => r.url).join("\n"));
    toast.success(`${filtered.length} آدرس کپی شد`);
  };

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="px-3 py-2 border-b dark:border-brand-dark flex items-center justify-between">
        <span className="font-bold text-slate-600 dark:text-white/70">
          بررسی سایت‌مپ
        </span>
        <span className="text-[11px] font-mono text-slate-400">
          {declared.length} آدرس اعلام‌شده
        </span>
      </div>

      {declared.length === 0 ? (
        <div className="p-6 text-center text-slate-400">
          سایت‌مپی پیدا نشد. یک کراول عمیق اجرا کنید — سایت‌مپ از
          <span className="font-mono mx-1">robots.txt</span>
          و مسیرهای پیش‌فرض خوانده می‌شود.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-1 px-2 py-2 border-b dark:border-brand-dark">
            {BUCKETS.map((b) => {
              const count = (buckets[b.key] || []).length;
              return (
                <button
                  key={b.key}
                  onClick={() => selectBucket(b)}
                  disabled={count === 0}
                  title={
                    count === 0
                      ? "موردی در این دسته نیست"
                      : b.inTable
                        ? "فیلتر کردن جدول اصلی به این آدرس‌ها"
                        : "این آدرس‌ها کراول نشده‌اند، پس ردیفی در جدول ندارند"
                  }
                  className={`flex items-center justify-between px-2 py-1.5 rounded transition-colors ${
                    count === 0 ? "opacity-40 cursor-default" : ""
                  } ${
                    active === b.key
                      ? "bg-brand-bright/10 border border-brand-bright/40"
                      : "hover:bg-black/5 dark:hover:bg-white/5 border border-transparent"
                  }`}
                >
                  <span className="text-[11px]">{b.label}</span>
                  <span className={`font-mono font-bold ${b.tone}`}>{count}</span>
                </button>
              );
            })}
          </div>

          {activeBucket?.inTable && (
            <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] bg-brand-bright/10 border-b border-brand-bright/30">
              <span className="font-bold text-brand-bright">
                جدول فیلتر شد: {rows.length} آدرس
              </span>
              <button
                onClick={copyAll}
                title="کپی همه"
                className="p-1 rounded border border-brand-bright/40 text-brand-bright hover:bg-brand-bright hover:text-white transition-colors"
              >
                <Copy className="w-3 h-3" />
              </button>
              <button
                onClick={() => selectBucket(activeBucket)}
                className="ml-auto px-2 py-0.5 rounded border border-brand-bright/40 text-brand-bright hover:bg-brand-bright hover:text-white transition-colors"
              >
                حذف فیلتر ✕
              </button>
            </div>
          )}

          {activeBucket && !activeBucket.inTable && (
            <>
              <div className="px-2 py-1.5 flex items-center gap-2 border-b dark:border-brand-dark">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="جستجو..."
                    className="w-full text-[11px] pl-6 pr-2 py-1 rounded border dark:border-brand-dark bg-white dark:bg-brand-darker"
                  />
                </div>
                {filtered.length > 0 && (
                  <button
                    onClick={copyAll}
                    title="کپی همه"
                    className="p-1 rounded border dark:border-brand-dark text-slate-500 hover:text-brand-bright"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                <ul className="divide-y divide-slate-100 dark:divide-white/5">
                  {filtered.map((r, i) => (
                    <li
                      key={`${r.url}-${i}`}
                      className="group flex items-center gap-2 px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <span className="text-[10px] font-mono text-slate-300 w-7 shrink-0 text-right">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className="text-[11px] font-mono truncate"
                          style={{ direction: "ltr", textAlign: "left" }}
                          title={r.url}
                        >
                          {r.url}
                        </div>
                        {r.detail && (
                          <div className="text-[10px] text-slate-400 truncate">
                            {r.detail}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => openBrowserWindow(r.url)}
                        className="shrink-0 p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-brand-bright"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {!activeBucket && (
            <div className="p-4 text-center text-[11px] leading-6 text-slate-400">
              یک دسته را انتخاب کنید تا جدول اصلی به همان آدرس‌ها فیلتر شود.
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SitemapReview;
