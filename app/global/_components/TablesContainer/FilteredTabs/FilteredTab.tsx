// @ts-nocheck
"use client";

// A crawl tab with Screaming Frog's filter dropdown above it.
//
// Layout follows SF: the filter sits at the top-left under the tab bar with a
// funnel icon, each option carries its own count, and the row count for the
// active filter is reported as "Filter Total" — so you can read how many pages
// match without scrolling the table.

import React, { useEffect, useMemo, useState } from "react";
import { Filter } from "lucide-react";
import useGlobalCrawlStore from "@/store/GlobalCrawlDataStore";
import TableCrawl from "../components/TableCrawl";
import { getFilterSet } from "./filterSets";

const FilteredTab = ({ tabKey, rows }: { tabKey: string; rows: any[] }) => {
  const set = getFilterSet(tabKey);
  const [activeKey, setActiveKey] = useState("all");

  // Clicking a row in the Overview tree sets tableFilter to "<tab>:<filter>";
  // when that names this tab, adopt the filter so the two stay in step.
  const tableFilter = useGlobalCrawlStore((st) => st.tableFilter);
  useEffect(() => {
    const kind = tableFilter?.kind;
    if (!kind || !kind.startsWith(`${tabKey}:`)) return;
    const wanted = kind.slice(tabKey.length + 1);
    setActiveKey(wanted);
  }, [tableFilter, tabKey]);

  const all = rows || [];

  // Counts for every option, computed together so the duplicate-detection
  // caches inside filterSets are built once per render rather than per option.
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    if (!set) return out;
    for (const f of set.filters) {
      let n = 0;
      for (const r of all) {
        try {
          if (f.match(r, all)) n++;
        } catch {
          /* a malformed row must not take the whole tab down */
        }
      }
      out[f.key] = n;
    }
    return out;
  }, [set, all]);

  const filtered = useMemo(() => {
    if (!set) return all;
    const f = set.filters.find((x) => x.key === activeKey);
    if (!f || f.key === "all") return all;
    return all.filter((r) => {
      try {
        return f.match(r, all);
      } catch {
        return false;
      }
    });
  }, [set, activeKey, all]);

  if (!set) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b dark:border-brand-dark shrink-0">
        <div className="relative flex items-center">
          <Filter className="absolute left-2 w-3 h-3 text-slate-400 pointer-events-none" />
          <select
            value={activeKey}
            onChange={(e) => setActiveKey(e.target.value)}
            className="text-xs border rounded pl-7 pr-2 py-1 bg-white dark:bg-brand-darker dark:border-brand-dark min-w-[210px]"
            style={{ direction: "ltr", textAlign: "left" }}
          >
            {set.filters.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label} ({counts[f.key] ?? 0})
              </option>
            ))}
          </select>
        </div>

        <span className="text-[11px] font-mono text-slate-500 dark:text-white/40 ml-auto">
          Filter Total: {filtered.length}
        </span>
      </div>

      <div className="flex-1 min-h-0">
        <TableCrawl tabName={set.label} rows={filtered} />
      </div>
    </div>
  );
};

export default FilteredTab;
