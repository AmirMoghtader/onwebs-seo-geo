// @ts-nocheck
"use client";

// Screaming Frog's Overview pane: a collapsible tree of crawl totals with a
// URLs column and a % of total column. Clicking a filter row jumps the main
// table to that tab and filter, which is how SF turns the overview into
// navigation rather than a read-only summary.

import React, { useMemo, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import useGlobalCrawlStore from "@/store/GlobalCrawlDataStore";
import { buildOverview } from "./computeOverview";

const num = (n: number) => n.toLocaleString("en-US");
const percent = (p: number | null) => (p === null ? "" : `${p.toFixed(2)}%`);

const Row = ({ label, urls, pct, depth, onClick, active, bold }: any) => (
  <div
    onClick={onClick}
    role={onClick ? "button" : undefined}
    className={`grid items-center h-[22px] text-[11px] border-b border-black/[0.04] dark:border-white/[0.04] ${
      onClick ? "cursor-pointer hover:bg-brand-bright/10" : ""
    } ${active ? "bg-brand-bright/20" : ""}`}
    style={{ gridTemplateColumns: "1fr 62px 68px" }}
  >
    <span
      className={`truncate ${bold ? "font-bold" : ""} text-slate-700 dark:text-white/80`}
      style={{ paddingInlineStart: 8 + depth * 14 }}
      title={label}
    >
      {label}
    </span>
    <span className="text-right font-mono text-slate-600 dark:text-white/70 pr-2">
      {urls === null ? "" : num(urls)}
    </span>
    <span className="text-right font-mono text-slate-400 dark:text-white/40 pr-2">
      {percent(pct)}
    </span>
  </div>
);

const OverviewTree = () => {
  const crawlData = useGlobalCrawlStore((s) => s.crawlData);
  const tableFilter = useGlobalCrawlStore((s) => s.tableFilter);
  const setTableFilter = useGlobalCrawlStore(
    (s) => s.actions.ui.setTableFilter,
  );
  const setDeepCrawlTab = useGlobalCrawlStore(
    (s) => s.actions.ui.setDeepCrawlTab,
  );

  const [openSummary, setOpenSummary] = useState(true);
  const [openCrawlData, setOpenCrawlData] = useState(true);
  const [openEls, setOpenEls] = useState<Record<string, boolean>>({
    internal: true,
  });

  const { summary, elements } = useMemo(
    () => buildOverview(crawlData || []),
    [crawlData],
  );

  const jump = (el: any, child: any) => {
    // Point the main table at this element's tab, then narrow it to the filter.
    setDeepCrawlTab?.(el.key);
    setTableFilter({
      kind: `${el.key}:${child.filter.filter}`,
      label: `${el.label} › ${child.label}`,
    });
  };

  return (
    <div className="flex flex-col h-full text-[11px] overflow-hidden">
      {/* Column headers */}
      <div
        className="grid items-center h-[22px] shrink-0 border-b dark:border-white/10 bg-slate-100 dark:bg-brand-darker font-bold text-slate-500 dark:text-white/50"
        style={{ gridTemplateColumns: "1fr 62px 68px" }}
      >
        <span />
        <span className="text-right pr-2">URLs</span>
        <span className="text-right pr-2">% of Total</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Summary */}
        <div
          onClick={() => setOpenSummary((v) => !v)}
          className="flex items-center gap-1 h-[24px] px-1 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 font-bold text-slate-700 dark:text-white/80"
        >
          {openSummary ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          Summary
        </div>
        {openSummary &&
          summary.map((r) => (
            <Row key={r.key} label={r.label} urls={r.urls} pct={r.pct} depth={1} />
          ))}

        {/* Crawl Data */}
        <div
          onClick={() => setOpenCrawlData((v) => !v)}
          className="flex items-center gap-1 h-[24px] px-1 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 font-bold text-slate-700 dark:text-white/80"
        >
          {openCrawlData ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          Crawl Data
        </div>

        {openCrawlData &&
          elements.map((el) => {
            const open = openEls[el.key];
            return (
              <React.Fragment key={el.key}>
                <div
                  onClick={() =>
                    setOpenEls((prev) => ({ ...prev, [el.key]: !prev[el.key] }))
                  }
                  className="grid items-center h-[22px] cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 border-b border-black/[0.04] dark:border-white/[0.04]"
                  style={{ gridTemplateColumns: "1fr 62px 68px" }}
                >
                  <span
                    className="flex items-center gap-1 truncate text-slate-700 dark:text-white/80"
                    style={{ paddingInlineStart: 14 }}
                  >
                    {open ? (
                      <ChevronDown className="w-3 h-3 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3 h-3 shrink-0" />
                    )}
                    {el.label}
                  </span>
                  <span className="text-right font-mono text-slate-600 dark:text-white/70 pr-2">
                    {num(el.all)}
                  </span>
                  <span />
                </div>

                {open &&
                  el.children.map((child) => (
                    <Row
                      key={child.key}
                      label={child.label}
                      urls={child.urls}
                      pct={child.pct}
                      depth={2}
                      active={
                        tableFilter?.kind ===
                        `${el.key}:${child.filter.filter}`
                      }
                      onClick={() => jump(el, child)}
                    />
                  ))}
              </React.Fragment>
            );
          })}
      </div>
    </div>
  );
};

export default OverviewTree;
