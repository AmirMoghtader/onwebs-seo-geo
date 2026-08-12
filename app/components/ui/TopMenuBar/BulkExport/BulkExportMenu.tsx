// @ts-nocheck
"use client";

// The Bulk Export menu, rendered as SF renders it: a top-level menu of
// categories, each opening a submenu of exports. Every leaf writes a CSV.

import React from "react";
import {
  MenubarItem,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
} from "@/components/ui/menubar";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import useGlobalCrawlStore from "@/store/GlobalCrawlDataStore";
import { BULK_EXPORTS } from "./bulkExportDefinitions";

const BulkExportMenu = () => {
  const crawlData = useGlobalCrawlStore((s) => s.crawlData);

  const run = async (item: any) => {
    const all = crawlData || [];
    if (!all.length) {
      toast.error("داده‌ای برای خروجی نیست — اول یک کراول اجرا کنید");
      return;
    }

    let rows: any[] = [];
    try {
      rows = item.select(all) || [];
    } catch (e) {
      console.error(e);
      toast.error("ساخت خروجی ناموفق بود");
      return;
    }

    if (!rows.length) {
      toast.message(`${item.label}: موردی پیدا نشد`);
      return;
    }

    const esc = (v: any) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = [
      item.columns.map((c: any) => esc(c.header)).join(","),
      ...rows.map((r) => item.columns.map((c: any) => esc(c.value(r))).join(",")),
    ].join("\n");

    try {
      const path = await save({
        defaultPath: `Onwebs-${item.key}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      // BOM so Excel reads the Persian and non-Latin URLs as UTF-8.
      await writeFile(path, new TextEncoder().encode("﻿" + csv));
      toast.success(`${item.label} — ${rows.length} ردیف ذخیره شد`);
    } catch (e) {
      console.error(e);
      toast.error("ذخیره فایل ناموفق بود");
    }
  };

  return (
    <>
      {BULK_EXPORTS.map((group) => (
        <MenubarSub key={group.label}>
          <MenubarSubTrigger>{group.label}</MenubarSubTrigger>
          <MenubarSubContent className="z-[9999999999999999]">
            {group.items.map((item) => (
              <MenubarItem key={item.key} onClick={() => run(item)}>
                {item.label}
              </MenubarItem>
            ))}
          </MenubarSubContent>
        </MenubarSub>
      ))}
    </>
  );
};

export default BulkExportMenu;
