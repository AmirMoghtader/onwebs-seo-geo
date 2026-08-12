// @ts-nocheck
"use client";

// The Reports menu. Each entry runs its report over the current crawl and
// writes a CSV, which is how Screaming Frog's Reports menu behaves — these are
// exports, not screens.

import React, { useState, useEffect } from "react";
import {
  MenubarItem,
  MenubarSeparator,
} from "@/components/ui/menubar";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import useGlobalCrawlStore from "@/store/GlobalCrawlDataStore";
import { REPORTS } from "./reportDefinitions";

function toCSV(rows: any[], columns: any[], all: any[]): string {
  const esc = (v: any) => {
    const t = String(v ?? "");
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [columns.map((c) => esc(c.header)).join(",")];
  for (const r of rows) {
    lines.push(columns.map((c) => esc(c.value(r, all))).join(","));
  }
  return lines.join("\n");
}

const ReportsMenu = () => {
  const crawlData = useGlobalCrawlStore((s) => s.crawlData);
  const [sitemapUrls, setSitemapUrls] = useState<string[]>([]);

  // The orphan report needs the sitemap's declared URLs, which arrive as an
  // event during the crawl rather than sitting in the store.
  useEffect(() => {
    const p = listen("sitemap_urls", (e: any) => {
      setSitemapUrls(Array.isArray(e.payload) ? e.payload : []);
    });
    return () => {
      p.then((f) => f());
    };
  }, []);

  const run = async (report: any) => {
    const all = crawlData || [];
    if (!all.length) {
      toast.error("داده‌ای برای گزارش نیست — اول یک کراول اجرا کنید");
      return;
    }

    let rows: any[] = [];
    try {
      rows = report.select(all, { sitemapUrls }) || [];
    } catch (e) {
      console.error(e);
      toast.error("ساخت گزارش ناموفق بود");
      return;
    }

    if (!rows.length) {
      toast.message(`${report.label}: موردی پیدا نشد`, {
        description: "این گزارش برای این کراول خالی است.",
      });
      return;
    }

    try {
      const path = await save({
        defaultPath: `Onwebs-${report.key}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      const csv = toCSV(rows, report.columns, all);
      // BOM keeps Persian and non-Latin URLs readable when Excel opens it.
      await writeFile(path, new TextEncoder().encode("﻿" + csv));
      toast.success(`${report.label} — ${rows.length} ردیف ذخیره شد`);
    } catch (e) {
      console.error(e);
      toast.error("ذخیره فایل ناموفق بود");
    }
  };

  return (
    <>
      {REPORTS.map((report, i) => (
        <React.Fragment key={report.key}>
          {i === 1 && <MenubarSeparator />}
          <MenubarItem onClick={() => run(report)} title={report.hint}>
            {report.label}
          </MenubarItem>
        </React.Fragment>
      ))}
    </>
  );
};

export default ReportsMenu;
