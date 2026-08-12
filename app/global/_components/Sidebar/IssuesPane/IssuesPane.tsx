// @ts-nocheck
"use client";

// Screaming Frog's Issues pane.
//
// Two stacked halves: a sortable list of detected issues on top, and an
// "Issue Details" panel underneath with a Description and a How To Fix for
// whichever issue is selected. Selecting an issue also narrows the main table
// to the affected URLs, which is what makes the pane a worklist rather than a
// report.

import React, { useMemo, useState } from "react";
import { AlertTriangle, AlertCircle, Info, Copy, Upload } from "lucide-react";
import { toast } from "sonner";
import useGlobalCrawlStore from "@/store/GlobalCrawlDataStore";
import { ISSUE_REGISTRY } from "../Issues/libs/issuesRegistry";

// Screaming Frog groups every issue as "Category: Problem" and grades it
// Issue / Warning / Opportunity. Our registry stores High/Medium/Low, so map
// the two onto the same three visual tiers.
const TIER = {
  High: {
    label: "Issue",
    icon: AlertCircle,
    className: "text-rose-500",
    rank: 0,
  },
  Medium: {
    label: "Warning",
    icon: AlertTriangle,
    className: "text-amber-500",
    rank: 1,
  },
  Low: {
    label: "Opportunity",
    icon: Info,
    className: "text-sky-500",
    rank: 2,
  },
};

/** "Missing Page Title" -> "Page Titles: Missing", closer to SF's naming. */
function categoryOf(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("title")) return "Page Titles";
  if (n.includes("description")) return "Meta Description";
  if (n.includes("h1")) return "H1";
  if (n.includes("h2")) return "H2";
  if (n.includes("canonical")) return "Canonicals";
  if (n.includes("index")) return "Directives";
  if (n.includes("4xx") || n.includes("5xx") || n.includes("response") || n.includes("redirect"))
    return "Response Codes";
  if (n.includes("image") || n.includes("alt")) return "Images";
  if (n.includes("https") || n.includes("secure") || n.includes("mixed")) return "Security";
  if (n.includes("word") || n.includes("content") || n.includes("readab")) return "Content";
  if (n.includes("link")) return "Links";
  if (n.includes("robot")) return "Robots";
  return "Validation";
}

const IssuesPane = () => {
  const crawlData = useGlobalCrawlStore((s) => s.crawlData);
  const robotsBlocked = useGlobalCrawlStore((s) => s.robotsBlocked);
  const setTableFilter = useGlobalCrawlStore((s) => s.actions.ui.setTableFilter);

  const [selected, setSelected] = useState<string | null>(null);

  const issues = useMemo(() => {
    const rows = crawlData || [];
    const total = rows.length || 1;

    return ISSUE_REGISTRY.map((def) => {
      let urls: any[] = [];
      try {
        urls = def.detect(rows, robotsBlocked) || [];
      } catch {
        urls = [];
      }
      const tier = TIER[def.priority] || TIER.Low;
      return {
        key: String(def.id),
        name: `${categoryOf(def.name)}: ${def.name}`,
        rawName: def.name,
        count: urls.length,
        pct: (urls.length / total) * 100,
        tier,
        fix: def.recommendedFix,
        urls,
      };
    })
      .filter((i) => i.count > 0)
      .sort((a, b) => a.tier.rank - b.tier.rank || b.count - a.count);
  }, [crawlData, robotsBlocked]);

  const current = issues.find((i) => i.key === selected) || null;

  const pick = (issue: any) => {
    setSelected(issue.key);
    setTableFilter({ kind: `issue:${issue.key}`, label: issue.name });
  };

  const copyDetails = () => {
    if (!current) return;
    const text = [
      current.name,
      `${current.count} URL`,
      "",
      current.fix,
      "",
      ...current.urls.map((u: any) => u?.url).filter(Boolean),
    ].join("\n");
    navigator.clipboard.writeText(text);
    toast.success("جزئیات مشکل کپی شد");
  };

  return (
    <div className="flex flex-col h-full text-[11px] overflow-hidden">
      {/* Issue list */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div
          className="grid items-center h-[22px] shrink-0 border-b dark:border-white/10 bg-slate-100 dark:bg-brand-darker font-bold text-slate-500 dark:text-white/50"
          style={{ gridTemplateColumns: "1fr 46px 54px" }}
        >
          <span className="pl-2">Issue Name</span>
          <span className="text-right pr-1">URLs</span>
          <span className="text-right pr-2">% of Total</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {issues.length === 0 ? (
            <div className="p-6 text-center text-slate-400">
              هیچ مشکلی پیدا نشد. یک کراول اجرا کنید.
            </div>
          ) : (
            issues.map((issue) => {
              const Icon = issue.tier.icon;
              return (
                <div
                  key={issue.key}
                  onClick={() => pick(issue)}
                  className={`grid items-center h-[24px] cursor-pointer border-b border-black/[0.04] dark:border-white/[0.04] ${
                    selected === issue.key
                      ? "bg-brand-bright/20"
                      : "hover:bg-brand-bright/10"
                  }`}
                  style={{ gridTemplateColumns: "1fr 46px 54px" }}
                >
                  <span className="flex items-center gap-1.5 min-w-0 pl-2">
                    <Icon className={`w-3 h-3 shrink-0 ${issue.tier.className}`} />
                    <span
                      className="truncate text-slate-700 dark:text-white/80"
                      title={issue.name}
                    >
                      {issue.name}
                    </span>
                  </span>
                  <span className="text-right font-mono text-slate-600 dark:text-white/70 pr-1">
                    {issue.count}
                  </span>
                  <span className="text-right font-mono text-slate-400 dark:text-white/40 pr-2">
                    {issue.pct.toFixed(1)}%
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Issue Details */}
      <div className="h-[46%] shrink-0 border-t dark:border-white/10 flex flex-col">
        <div className="flex items-center gap-2 px-2 h-[26px] shrink-0 border-b dark:border-white/10 bg-slate-100 dark:bg-brand-darker">
          <button
            onClick={copyDetails}
            disabled={!current}
            className="flex items-center gap-1 text-[10px] border rounded px-1.5 py-0.5 dark:border-white/10 disabled:opacity-40 hover:text-brand-bright hover:border-brand-bright"
          >
            <Copy className="w-2.5 h-2.5" />
            Copy
          </button>
          <span className="font-bold text-slate-600 dark:text-white/70">
            Issue Details
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {!current ? (
            <div className="text-center text-slate-400 pt-6">
              یک مشکل را از فهرست بالا انتخاب کنید.
            </div>
          ) : (
            <>
              <h3 className="text-[13px] font-bold text-slate-800 dark:text-white mb-1">
                Description
              </h3>
              <p className="leading-relaxed text-slate-600 dark:text-white/70 mb-4">
                {current.count} صفحه این مشکل را دارد
                {current.pct >= 1 ? ` (${current.pct.toFixed(1)}٪ از کل)` : ""}.
              </p>

              <h3 className="text-[13px] font-bold text-slate-800 dark:text-white mb-1">
                How To Fix
              </h3>
              <p className="leading-relaxed text-slate-600 dark:text-white/70 mb-4">
                {current.fix}
              </p>

              <h3 className="text-[13px] font-bold text-slate-800 dark:text-white mb-1">
                آدرس‌های درگیر
              </h3>
              <ul className="space-y-0.5">
                {current.urls.slice(0, 200).map((u: any, i: number) => (
                  <li
                    key={i}
                    className="font-mono text-[10px] text-slate-500 dark:text-white/50 truncate"
                    style={{ direction: "ltr", textAlign: "left" }}
                    title={u?.url}
                  >
                    {u?.url}
                  </li>
                ))}
                {current.urls.length > 200 && (
                  <li className="text-[10px] text-slate-400 pt-1">
                    … و {current.urls.length - 200} مورد دیگر (برای فهرست کامل
                    Copy را بزنید)
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default IssuesPane;
