// @ts-nocheck
"use client";

// Screaming Frog's "URL Details" pane: every field it knows about the selected
// URL, as a vertical Name/Value list rather than a wide table.
//
// This is how SF reaches the detail density of its 73-column export without
// making you scroll sideways forever — the columns become rows, and the
// selected URL is the context. The footer count mirrors SF's "Total: N".

import React, { useMemo, useState } from "react";
import { Search, Copy, Upload } from "lucide-react";
import { toast } from "sonner";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import {
  titlePixels,
  descriptionPixels,
  TITLE_PIXEL_LIMIT,
  DESCRIPTION_PIXEL_LIMIT,
} from "./pixelWidth";
import { statusText } from "../../InternalTable/columns";

interface Field {
  name: string;
  value: any;
  /** highlight when the value is a problem worth noticing */
  warn?: boolean;
}

const len = (v: any) => (v ? String(v).length : "");
const arr = (v: any): any[] => (Array.isArray(v) ? v : v ? [v] : []);

function sentenceCount(text: string): number {
  if (!text) return 0;
  return (text.match(/[.!?۔؟]+/g) || []).length || 1;
}

function buildFields(p: any): Field[] {
  if (!p) return [];

  const meta = p?.page_meta || {};
  const pag = p?.pagination || {};
  const title = p?.title?.[0]?.title || "";
  const desc = p?.description || "";
  const h1s = p?.headings?.h1 || [];
  const h2s = p?.headings?.h2 || [];
  const canon = arr(p?.canonicals);
  const robots = p?.meta_robots?.meta_robots || [];
  const code = Number(p?.status_code) || 0;
  const words = Number(p?.word_count) || 0;
  const hreflangs = p?.hreflangs || [];

  const sentences = Number(p?.sentence_count) || 0;

  const titlePx = titlePixels(title);
  const descPx = descriptionPixels(desc);

  const bytes = Number(meta.transferred_bytes) || 0;
  const kb = (n: number) => (n ? `${(n / 1024).toFixed(1)} kB` : "");
  const co2 = bytes ? (bytes * 0.000000000072 * 442 * 1000).toFixed(3) : "";

  let folderDepth: number | "" = "";
  try {
    folderDepth = new URL(p.url).pathname.split("/").filter(Boolean).length;
  } catch {
    folderDepth = "";
  }

  const internal = p?.inoutlinks_status_codes?.internal || [];
  const external = p?.inoutlinks_status_codes?.external || [];
  const uniq = (list: any[]) => {
    const seen = new Set<string>();
    for (const l of list || []) {
      const u = typeof l === "string" ? l : l?.url || l?.href || l?.link;
      if (u) seen.add(String(u).split("#")[0]);
    }
    return seen.size;
  };

  // Field order mirrors Screaming Frog's URL Details export exactly.
  const f: Field[] = [
    { name: "Address", value: p?.url || "" },
    {
      name: "URL Encoded Address",
      value: (() => {
        try {
          return p?.url ? encodeURI(p.url) : "";
        } catch {
          return p?.url || "";
        }
      })(),
    },
    { name: "Content Type", value: p?.content_type || "" },
    { name: "Status Code", value: code || "" },
    { name: "Status", value: statusText(code) },
    {
      name: "Indexability",
      value: p?.is_asset
        ? ""
        : (p?.indexability?.indexability ?? 0.5) >= 0.5
          ? "Indexable"
          : "Non-Indexable",
      warn: !p?.is_asset && (p?.indexability?.indexability ?? 0.5) < 0.5,
    },
    { name: "Indexability Status", value: p?.indexability?.indexability_reason || "" },

    { name: "Title 1", value: title },
    { name: "Title 1 Length", value: len(title), warn: title.length > 60 },
    { name: "Title 1 Pixel Width", value: titlePx || "", warn: titlePx > TITLE_PIXEL_LIMIT },

    { name: "Meta Description 1", value: desc },
    { name: "Meta Description 1 Length", value: len(desc), warn: desc.length > 155 },
    {
      name: "Meta Description 1 Pixel Width",
      value: descPx || "",
      warn: descPx > DESCRIPTION_PIXEL_LIMIT,
    },

    { name: "Meta Keywords 1", value: meta.meta_keywords || "" },
    { name: "Meta Keywords 1 Length", value: len(meta.meta_keywords) },

    { name: "H1-1", value: h1s[0] || "", warn: !h1s[0] && !p?.is_asset },
    { name: "H1-1 Length", value: len(h1s[0]) },
    { name: "H2-1", value: h2s[0] || "" },
    { name: "H2-1 Length", value: len(h2s[0]) },
    { name: "H2-2", value: h2s[1] || "" },
    { name: "H2-2 Length", value: len(h2s[1]) },

    { name: "Meta Robots 1", value: robots[0] || "" },
    { name: "Meta Robots 2", value: robots[1] || "" },
    { name: "X-Robots-Tag 1", value: meta.x_robots_tag || "" },
    { name: "Meta Refresh 1", value: meta.meta_refresh || "" },

    { name: "Canonical Link Element 1", value: canon[0] || "" },
    { name: "Canonical Link Element 1 Origin", value: canon[0] ? "HTML" : "" },
    {
      name: "Canonical Link Element 1 Indexability",
      value: canon[0]
        ? (p?.indexability?.indexability ?? 0.5) >= 0.5
          ? "Indexable"
          : "Non-Indexable"
        : "",
    },
    { name: 'rel="next" 1', value: pag.next || "" },
    { name: 'rel="prev" 1', value: pag.prev || "" },
    { name: 'HTTP rel="next" 1', value: meta.http_rel_next || "" },
    { name: 'HTTP rel="prev" 1', value: meta.http_rel_prev || "" },
    { name: "amphtml Link Element", value: pag.amphtml || "" },

    { name: "Size", value: kb(Number(p?.page_size?.[0]?.bytes) || 0) },
    { name: "Transferred", value: kb(bytes) },
    { name: "Total Transferred", value: kb(bytes) },
    { name: "CO2 (mg)", value: co2 },

    { name: "Word Count", value: words || "" },
    { name: "Sentence Count", value: sentences || "" },
    {
      name: "Average Words Per Sentence",
      value: sentences ? (words / sentences).toFixed(2) : "",
    },
    {
      name: "Flesch Reading Ease Score",
      value:
        typeof p?.flesch === "number"
          ? p.flesch.toFixed(2)
          : p?.flesch?.Ok?.[0] != null
            ? Number(p.flesch.Ok[0]).toFixed(2)
            : "",
    },
    { name: "Readability", value: p?.flesch_grade || p?.flesch?.Ok?.[1] || "" },
    {
      name: "Text Ratio",
      value:
        typeof p?.text_ratio === "number"
          ? p.text_ratio.toFixed(2)
          : p?.text_ratio?.[0]?.text_ratio != null
            ? Number(p.text_ratio[0].text_ratio).toFixed(2)
            : "",
    },

    { name: "Crawl Depth", value: p?.url_depth ?? "" },
    { name: "Folder Depth", value: folderDepth },
    { name: "Link Score", value: p?.link_score ?? "" },

    { name: "Inlinks", value: p?.inlinks_count ?? "" },
    { name: "Unique Inlinks", value: p?.unique_inlinks_count ?? "" },
    { name: "Outlinks", value: internal.length || "" },
    { name: "Unique Outlinks", value: uniq(internal) || "" },
    { name: "External Outlinks", value: external.length || "" },
    { name: "Unique External Outlinks", value: uniq(external) || "" },

    { name: "Hash", value: meta.content_hash || "" },
    {
      name: "Response Time",
      value: p?.response_time != null ? Number(p.response_time).toFixed(2) : "",
    },
    { name: "Last Modified", value: meta.last_modified || "" },
  ];

  // Screaming Frog emits one group of four fields per hreflang entry.
  hreflangs.forEach((h: any, i: number) => {
    const n = i + 1;
    const code2 = String(h?.code || "");
    f.push({ name: `HTML hreflang ${n}`, value: code2 });
    f.push({ name: `HTML hreflang ${n} URL`, value: h?.url || "" });
    f.push({
      name: `HTML hreflang ${n} Language Code Valid`,
      // A valid value is either x-default or a language[-REGION] tag.
      value: /^(x-default|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/i.test(code2)
        ? "Valid"
        : code2
          ? "Invalid"
          : "",
      warn: Boolean(code2) && !/^(x-default|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/i.test(code2),
    });
    f.push({ name: `HTML hreflang ${n} Confirmation Status`, value: h?.url ? "OK" : "" });
  });

  f.push(
    { name: "Language", value: p?.language || "" },
    { name: "HTTP Version", value: meta.http_version || "" },
    { name: "Mobile Alternate Link", value: meta.mobile_alternate || "" },
    { name: "Redirect URL", value: p?.redirect_url || "" },
    { name: "Redirect Type", value: p?.redirection_type || "" },
    {
      name: "Cookies",
      value:
        typeof p?.cookies_count === "number"
          ? p.cookies_count
          : Array.isArray(p?.cookies?.Ok)
            ? p.cookies.Ok.length
            : Array.isArray(p?.cookies)
              ? p.cookies.length
              : "",
    },
    { name: "URL Length", value: p?.url ? String(p.url).length : "" },
    {
      name: "Schema.org Types",
      value: p?.schema === true ? "Yes" : typeof p?.schema === "string" ? p.schema : "",
    },
    {
      name: "OpenGraph",
      value: p?.opengraph
        ? typeof p.opengraph === "boolean"
          ? "Yes"
          : `${Object.keys(p.opengraph).length} tags`
        : "",
    },
    { name: "Mobile Friendly", value: p?.mobile === undefined ? "" : p.mobile ? "Yes" : "No" },
    { name: "Found At", value: p?.found_at || "" },
    { name: "Crawl Timestamp", value: meta.crawl_timestamp || "" },
  );

  return f;
}

const UrlDetailsPane = ({ data, height }: any) => {
  const [query, setQuery] = useState("");
  const page = Array.isArray(data) ? data[0] : data;

  const fields = useMemo(() => buildFields(page), [page]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        String(f.value ?? "").toLowerCase().includes(q),
    );
  }, [fields, query]);

  const exportCSV = async () => {
    const esc = (v: any) => {
      const t = String(v ?? "");
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lines = ["Name,Value", ...shown.map((f) => `${esc(f.name)},${esc(f.value)}`)];
    try {
      const path = await save({
        defaultPath: "Onwebs-URL-Details.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      await writeFile(path, new TextEncoder().encode("﻿" + lines.join("\n")));
      toast.success("جزئیات URL ذخیره شد");
    } catch {
      toast.error("خروجی گرفتن ناموفق بود");
    }
  };

  if (!page) {
    return (
      <div
        className="flex items-center justify-center w-full text-sm text-slate-400"
        style={{ height: `${(height || 300) - 15}px` }}
      >
        برای دیدن جزئیات، یک URL از جدول بالا انتخاب کنید
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="flex items-center gap-2 px-2 py-1.5 shrink-0 border-b dark:border-brand-dark">
        <button
          onClick={exportCSV}
          className="flex items-center gap-1 border rounded px-2 py-1 dark:border-brand-dark text-slate-500 hover:text-brand-bright hover:border-brand-bright"
        >
          <Upload className="w-3 h-3" />
          Export
        </button>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجو..."
            className="w-full pl-7 pr-2 py-1 rounded border dark:border-brand-dark bg-white dark:bg-brand-darker"
          />
        </div>
      </div>

      <div
        className="grid items-center h-[24px] shrink-0 border-b dark:border-brand-dark bg-slate-100 dark:bg-brand-darker font-bold text-slate-500 dark:text-white/50"
        style={{ gridTemplateColumns: "260px 1fr" }}
      >
        <span className="pl-3">Name</span>
        <span className="pl-3">Value</span>
      </div>

      <div className="flex-1 overflow-auto">
        {shown.map((f, i) => (
          <div
            key={f.name}
            onDoubleClick={() => {
              navigator.clipboard.writeText(String(f.value ?? ""));
              toast.success("مقدار کپی شد");
            }}
            className={`grid items-center min-h-[24px] border-b border-black/[0.04] dark:border-white/[0.04] ${
              i % 2 ? "bg-black/[0.015] dark:bg-white/[0.015]" : ""
            } hover:bg-brand-bright/5`}
            style={{ gridTemplateColumns: "260px 1fr" }}
            title="برای کپی مقدار، دوبار کلیک کنید"
          >
            <span className="pl-3 text-slate-500 dark:text-white/50 truncate">
              {f.name}
            </span>
            <span
              className={`pl-3 py-1 break-words ${
                f.warn
                  ? "text-rose-500 font-medium"
                  : "text-slate-700 dark:text-white/80"
              }`}
              style={{ unicodeBidi: "plaintext" }}
            >
              {f.value === "" || f.value === null || f.value === undefined
                ? ""
                : String(f.value)}
            </span>
          </div>
        ))}
      </div>

      <div className="shrink-0 text-right px-3 py-0.5 text-[10px] text-slate-400 border-t dark:border-brand-dark">
        Total: {shown.length}
      </div>
    </div>
  );
};

export default UrlDetailsPane;
