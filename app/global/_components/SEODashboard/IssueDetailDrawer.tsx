// @ts-nocheck
"use client";

// A side drawer rather than a modal: the user asked for "a full explanation and
// the list of affected URLs", and a URL list wants vertical room and a scroll
// of its own. A drawer also leaves the dashboard visible behind it, so you can
// work down the action plan without losing your place.

import React, { useMemo, useState } from "react";
import { X, ExternalLink, Copy, Search } from "lucide-react";
import { toast } from "sonner";
import openBrowserWindow from "@/app/Hooks/OpenBrowserWindow";
import { resolveAffectedPages } from "./affectedUrls";

const IssueDetailDrawer = ({ issue, crawlData, severity, onClose }: any) => {
  const [query, setQuery] = useState("");

  const pages = useMemo(
    () => (issue ? resolveAffectedPages(issue.key, crawlData || []) : []),
    [issue, crawlData],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter(
      (p) =>
        p.url.toLowerCase().includes(q) ||
        (p.detail || "").toLowerCase().includes(q),
    );
  }, [pages, query]);

  if (!issue) return null;

  const copyAll = () => {
    navigator.clipboard.writeText(filtered.map((p) => p.url).join("\n"));
    toast.success(`${filtered.length} آدرس در کلیپ‌بورد کپی شد`);
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-[9998] animate-in fade-in duration-150"
        onClick={onClose}
      />
      <aside className="fixed top-0 right-0 h-full w-[640px] max-w-[92vw] z-[9999] bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${severity?.soft} ${severity?.text}`}
              >
                {severity?.label}
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {issue.count?.toLocaleString?.() ?? issue.count} مورد
              </span>
            </div>
            <h2 className="text-base font-bold text-slate-800 dark:text-white truncate">
              {issue.label}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* What it means and what to do */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-[10px] font-bold uppercase text-slate-400 mb-2">
            این یعنی چه و چه باید کرد
          </h3>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {issue.recommendation}
          </p>
        </div>

        {/* Affected URLs */}
        <div className="px-5 py-3 flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجو در آدرس‌ها..."
              className="w-full text-xs pl-7 pr-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>
          <span className="text-[11px] font-mono text-slate-400 shrink-0">
            {filtered.length}
          </span>
          {filtered.length > 0 && (
            <button
              onClick={copyAll}
              title="کپی همه آدرس‌ها"
              className="shrink-0 p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-brand-bright hover:border-brand-bright"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              {pages.length === 0
                ? "برای این مشکل نمی‌توان آدرس‌ها را از داده‌ی کراول فعلی استخراج کرد. یک کراول تازه اجرا کنید."
                : "آدرسی با این جستجو پیدا نشد."}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((p, i) => (
                <li
                  key={`${p.url}-${i}`}
                  className="group flex items-center gap-2 px-5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <span className="text-[10px] font-mono text-slate-300 dark:text-slate-600 w-8 shrink-0 text-right">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-[11px] font-mono text-slate-700 dark:text-slate-200 truncate"
                      style={{ direction: "ltr", textAlign: "left" }}
                      title={p.url}
                    >
                      {p.url}
                    </div>
                    {p.detail && (
                      <div className="text-[10px] text-slate-400 truncate">
                        {p.detail}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => openBrowserWindow(p.url)}
                    title="باز کردن در مرورگر"
                    className="shrink-0 p-1 rounded text-slate-300 opacity-0 group-hover:opacity-100 hover:text-brand-bright transition-opacity"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
};

export default IssueDetailDrawer;
