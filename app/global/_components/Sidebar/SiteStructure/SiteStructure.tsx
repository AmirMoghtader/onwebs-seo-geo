// @ts-nocheck
"use client";

// Screaming Frog's Site Structure pane: a directory tree of the crawl on top,
// the crawl-depth histogram underneath. Together they answer "how is this site
// laid out, and how deep do you have to click to reach things" — which is the
// question the flat URL table can't.

import React, { useMemo, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  FolderClosed,
  FileText,
  Minimize2,
  Maximize2,
  Upload,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import useGlobalCrawlStore from "@/store/GlobalCrawlDataStore";
import { buildPathTree, buildDepthHistogram } from "./buildTree";

// Same colour semantics Screaming Frog uses in its depth chart.
const SERIES = [
  { key: "blocked", label: "Blocked by robots.txt", color: "#9ca3af" },
  { key: "noResponse", label: "No Response", color: "#f9a8d4" },
  { key: "s2xx", label: "2xx", color: "#22c55e" },
  { key: "s3xx", label: "3xx", color: "#f59e0b" },
  { key: "s4xx", label: "4xx", color: "#ef4444" },
  { key: "s5xx", label: "5xx", color: "#991b1b" },
];

const SiteStructure = () => {
  const crawlData = useGlobalCrawlStore((s) => s.crawlData);
  const robotsBlocked = useGlobalCrawlStore((s) => s.robotsBlocked);

  const { root, maxLevel } = useMemo(
    () => buildPathTree(crawlData || []),
    [crawlData],
  );
  const depth = useMemo(
    () => buildDepthHistogram(crawlData || [], robotsBlocked || []),
    [crawlData, robotsBlocked],
  );

  const [levelLimit, setLevelLimit] = useState(2);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const isOpen = (node: any) =>
    collapsed[node.key] === undefined ? node.level < levelLimit : !collapsed[node.key];

  const toggle = (key: string, currentlyOpen: boolean) =>
    setCollapsed((prev) => ({ ...prev, [key]: currentlyOpen }));

  const exportTree = async () => {
    const lines = ["Path,URLs"];
    const walk = (n: any, prefix: string) => {
      for (const c of n.children) {
        const path = prefix + c.label;
        lines.push(`"${path}",${c.urls}`);
        walk(c, path);
      }
    };
    if (root) walk(root, "");
    try {
      const path = await save({
        defaultPath: "Onwebs-Site-Structure.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      await writeFile(path, new TextEncoder().encode("﻿" + lines.join("\n")));
      toast.success("ساختار سایت ذخیره شد");
    } catch {
      toast.error("خروجی گرفتن ناموفق بود");
    }
  };

  const renderNode = (node: any): React.ReactNode => {
    const hasKids = node.children.length > 0;
    const open = hasKids && isOpen(node);

    return (
      <React.Fragment key={node.key}>
        <div
          onClick={() => hasKids && toggle(node.key, open)}
          className={`grid items-center h-[22px] border-b border-black/[0.04] dark:border-white/[0.04] ${
            hasKids ? "cursor-pointer hover:bg-brand-bright/10" : ""
          }`}
          style={{ gridTemplateColumns: "1fr 54px" }}
        >
          <span
            className="flex items-center gap-1 truncate text-slate-700 dark:text-white/80"
            style={{ paddingInlineStart: 4 + node.level * 12 }}
            title={node.url || node.label}
          >
            {hasKids ? (
              open ? (
                <ChevronDown className="w-3 h-3 shrink-0 text-slate-400" />
              ) : (
                <ChevronRight className="w-3 h-3 shrink-0 text-slate-400" />
              )
            ) : (
              <span className="w-3 shrink-0" />
            )}
            {hasKids ? (
              <FolderClosed className="w-3 h-3 shrink-0 text-amber-500" />
            ) : (
              <FileText className="w-3 h-3 shrink-0 text-sky-500" />
            )}
            <span className="truncate">{node.label}</span>
          </span>
          <span className="text-right font-mono text-slate-600 dark:text-white/70 pr-2">
            {node.urls.toLocaleString("en-US")}
          </span>
        </div>
        {open && node.children.map(renderNode)}
      </React.Fragment>
    );
  };

  return (
    <div className="flex flex-col h-full text-[11px] overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2 h-[28px] shrink-0 border-b dark:border-white/10">
        <button
          onClick={() => setCollapsed({})}
          title="بازکردن تا سطح انتخاب‌شده"
          className="p-1 rounded border dark:border-white/10 text-slate-500 hover:text-brand-bright"
        >
          <Maximize2 className="w-3 h-3" />
        </button>
        <button
          onClick={() => {
            const all: Record<string, boolean> = {};
            const walk = (n: any) => {
              if (n.children.length) all[n.key] = true;
              n.children.forEach(walk);
            };
            if (root) walk(root);
            setCollapsed(all);
          }}
          title="بستن همه"
          className="p-1 rounded border dark:border-white/10 text-slate-500 hover:text-brand-bright"
        >
          <Minimize2 className="w-3 h-3" />
        </button>

        <label className="flex items-center gap-1 text-slate-500 dark:text-white/50">
          Level:
          <select
            value={levelLimit}
            onChange={(e) => {
              setLevelLimit(Number(e.target.value));
              setCollapsed({});
            }}
            className="text-[11px] border rounded px-1 py-0.5 bg-white dark:bg-brand-darker dark:border-white/10"
          >
            {Array.from({ length: Math.max(maxLevel, 1) + 1 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={exportTree}
          className="flex items-center gap-1 ml-auto text-[10px] border rounded px-1.5 py-0.5 dark:border-white/10 text-slate-500 hover:text-brand-bright hover:border-brand-bright"
        >
          <Upload className="w-2.5 h-2.5" />
          Export
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div
          className="grid items-center h-[22px] shrink-0 border-b dark:border-white/10 bg-slate-100 dark:bg-brand-darker font-bold text-slate-500 dark:text-white/50"
          style={{ gridTemplateColumns: "1fr 54px" }}
        >
          <span className="pl-2">Path</span>
          <span className="text-right pr-2">URLs</span>
        </div>

        <div className="flex-1 overflow-auto">
          {!root ? (
            <div className="p-6 text-center text-slate-400">
              داده‌ای نیست. یک کراول اجرا کنید.
            </div>
          ) : (
            root.children.map(renderNode)
          )}
        </div>

        {root && (
          <div className="shrink-0 text-right pr-2 py-0.5 text-[10px] text-slate-400 border-t dark:border-white/10">
            Max Level: {maxLevel}
          </div>
        )}
      </div>

      {/* Crawl Depth */}
      <div className="h-[42%] shrink-0 border-t dark:border-white/10 flex flex-col">
        <div className="px-2 h-[24px] shrink-0 flex items-center font-bold text-slate-600 dark:text-white/70 border-b dark:border-white/10 bg-slate-100 dark:bg-brand-darker">
          Crawl Depth
        </div>

        <div className="flex-1 min-h-0 p-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={depth} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
              <CartesianGrid strokeDasharray="2 2" stroke="rgba(128,128,128,0.15)" />
              <XAxis dataKey="depth" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(v: any, k: any) =>
                  [v, SERIES.find((s) => s.key === k)?.label || k]
                }
              />
              {SERIES.map((s) => (
                <Bar key={s.key} dataKey={s.key} stackId="d" fill={s.color} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="shrink-0 grid grid-cols-2 gap-x-2 px-2 pb-1 text-[9px]">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1 truncate">
              <span
                className="w-2 h-2 rounded-[2px] shrink-0"
                style={{ background: s.color }}
              />
              <span className="truncate text-slate-500 dark:text-white/50">
                {s.label}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SiteStructure;
