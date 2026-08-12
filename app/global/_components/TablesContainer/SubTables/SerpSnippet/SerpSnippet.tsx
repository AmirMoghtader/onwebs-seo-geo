// @ts-nocheck
"use client";

// Screaming Frog's SERP Snippet pane: a live Google-style preview of the
// selected URL, plus the measurement table that tells you whether the title
// and description actually fit.
//
// The table is the point. "72 characters" means nothing on its own — what
// matters is that those 72 characters render 588px wide against a 561px
// budget, so 5 of them get cut. The title and description are editable so you
// can draft a replacement and watch the numbers move before touching the site.

import React, { useEffect, useMemo, useState } from "react";
import { RotateCcw, Globe } from "lucide-react";
import {
  titlePixels,
  descriptionPixels,
  truncation,
  TITLE_PIXEL_LIMIT,
  DESCRIPTION_PIXEL_LIMIT,
} from "../DetailsTable/pixelWidth";

// Google gives mobile results less room than desktop.
const DEVICE_LIMITS = {
  Desktop: { title: TITLE_PIXEL_LIMIT, description: DESCRIPTION_PIXEL_LIMIT },
  Mobile: { title: 920, description: 1560 },
};

const Num = ({ value, bad, good }: any) => (
  <span
    className={`font-mono ${
      bad ? "text-rose-500 font-bold" : good ? "text-emerald-500" : ""
    }`}
  >
    {value}
  </span>
);

const SerpSnippet = ({ data }: any) => {
  const page = Array.isArray(data) ? data[0] : data;

  const originalTitle = page?.title?.[0]?.title || "";
  const originalDesc = page?.description || "";

  const [device, setDevice] = useState("Desktop");
  const [title, setTitle] = useState(originalTitle);
  const [desc, setDesc] = useState(originalDesc);
  const [siteName, setSiteName] = useState("");
  const [descPrefix, setDescPrefix] = useState("");

  // Reset the drafts whenever a different URL is selected, otherwise the
  // previous page's edits would appear to belong to this one.
  useEffect(() => {
    setTitle(originalTitle);
    setDesc(originalDesc);
  }, [originalTitle, originalDesc]);

  const limits = DEVICE_LIMITS[device] || DEVICE_LIMITS.Desktop;

  const fullDesc = descPrefix ? `${descPrefix} ${desc}` : desc;

  const t = useMemo(
    () => truncation(title, limits.title, titlePixels),
    [title, limits.title],
  );
  const d = useMemo(
    () => truncation(fullDesc, limits.description, descriptionPixels),
    [fullDesc, limits.description],
  );

  if (!page) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-slate-400">
        برای دیدن SERP Snippet، یک URL از جدول بالا انتخاب کنید
      </div>
    );
  }

  let host = "";
  try {
    host = new URL(page.url).host;
  } catch {
    host = page?.url || "";
  }

  const shownTitle = t.truncated ? `${title.slice(0, t.displayed)}…` : title;
  const shownDesc = d.truncated ? `${fullDesc.slice(0, d.displayed)}…` : fullDesc;

  return (
    <div className="flex flex-col h-full overflow-auto text-xs">
      <div className="flex gap-4 p-3">
        {/* Google-style preview */}
        <div className="flex-1 min-w-0 max-w-[560px]">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
              <Globe className="w-3 h-3 text-slate-500" />
            </span>
            <span className="min-w-0">
              <div
                className="text-[13px] text-slate-800 dark:text-white/90 truncate"
                style={{ direction: "ltr", textAlign: "left" }}
              >
                {siteName || host}
              </div>
              <div
                className="text-[11px] text-slate-500 dark:text-white/50 truncate"
                style={{ direction: "ltr", textAlign: "left" }}
              >
                {page.url}
              </div>
            </span>
          </div>

          <div
            className="text-[19px] leading-tight mb-1"
            style={{ color: "#1a0dab", unicodeBidi: "plaintext" }}
          >
            {shownTitle || <span className="text-slate-400">(بدون Title)</span>}
          </div>
          <div
            className="text-[13px] text-slate-600 dark:text-white/60 leading-snug"
            style={{ unicodeBidi: "plaintext" }}
          >
            {shownDesc || (
              <span className="text-slate-400">(بدون Meta Description)</span>
            )}
          </div>
        </div>

        {/* Measurement table */}
        <div className="shrink-0">
          <table className="border-collapse text-[11px]">
            <thead>
              <tr className="text-slate-500 dark:text-white/50">
                <th className="border dark:border-white/10 px-2 py-1" />
                <th
                  className="border dark:border-white/10 px-2 py-1 text-center"
                  colSpan={3}
                >
                  Chars
                </th>
                <th
                  className="border dark:border-white/10 px-2 py-1 text-center"
                  colSpan={3}
                >
                  Pixels
                </th>
              </tr>
              <tr className="text-slate-500 dark:text-white/50">
                <th className="border dark:border-white/10 px-2 py-1 text-left">
                  Element
                </th>
                <th className="border dark:border-white/10 px-2 py-1">Length</th>
                <th className="border dark:border-white/10 px-2 py-1">Displayed</th>
                <th className="border dark:border-white/10 px-2 py-1">Truncated</th>
                <th className="border dark:border-white/10 px-2 py-1">Length</th>
                <th className="border dark:border-white/10 px-2 py-1">Available</th>
                <th className="border dark:border-white/10 px-2 py-1">Remaining</th>
              </tr>
            </thead>
            <tbody className="text-slate-700 dark:text-white/80">
              {[
                { label: "Title", m: t },
                { label: "Description", m: d },
              ].map(({ label, m }) => (
                <tr key={label}>
                  <td className="border dark:border-white/10 px-2 py-1">{label}</td>
                  <td className="border dark:border-white/10 px-2 py-1 text-center font-mono">
                    {m.length}
                  </td>
                  <td className="border dark:border-white/10 px-2 py-1 text-center font-mono">
                    {m.displayed}
                  </td>
                  <td className="border dark:border-white/10 px-2 py-1 text-center">
                    <Num value={m.truncated} bad={m.truncated > 0} />
                  </td>
                  <td className="border dark:border-white/10 px-2 py-1 text-center font-mono">
                    {m.pixels}
                  </td>
                  <td className="border dark:border-white/10 px-2 py-1 text-center font-mono">
                    {m.available}
                  </td>
                  <td className="border dark:border-white/10 px-2 py-1 text-center">
                    <Num
                      value={m.remaining}
                      bad={m.remaining < 0}
                      good={m.remaining >= 0}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Editable draft */}
      <div className="grid gap-2 px-3 pb-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="space-y-2">
          <label className="flex items-start gap-2">
            <span className="w-16 shrink-0 pt-1 text-slate-500 dark:text-white/50">
              Title
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="flex-1 border rounded px-2 py-1 dark:border-brand-dark bg-white dark:bg-brand-darker"
            />
          </label>
          <label className="flex items-start gap-2">
            <span className="w-16 shrink-0 pt-1 text-slate-500 dark:text-white/50">
              Description
            </span>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={4}
              className="flex-1 border rounded px-2 py-1 dark:border-brand-dark bg-white dark:bg-brand-darker resize-none"
            />
          </label>
          <button
            onClick={() => {
              setTitle(originalTitle);
              setDesc(originalDesc);
              setDescPrefix("");
            }}
            className="flex items-center gap-1 border rounded px-2 py-1 dark:border-brand-dark text-slate-500 hover:text-brand-bright hover:border-brand-bright"
          >
            <RotateCcw className="w-3 h-3" />
            Revert Changes
          </button>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-slate-500 dark:text-white/50">
              Device
            </span>
            <select
              value={device}
              onChange={(e) => setDevice(e.target.value)}
              className="flex-1 border rounded px-2 py-1 dark:border-brand-dark bg-white dark:bg-brand-darker"
            >
              <option>Desktop</option>
              <option>Mobile</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-slate-500 dark:text-white/50">
              Site Name
            </span>
            <input
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="Enter Site Name here..."
              className="flex-1 border rounded px-2 py-1 dark:border-brand-dark bg-white dark:bg-brand-darker"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-slate-500 dark:text-white/50">
              Description Prefix
            </span>
            <input
              value={descPrefix}
              onChange={(e) => setDescPrefix(e.target.value)}
              placeholder="Enter Description Prefix here..."
              className="flex-1 border rounded px-2 py-1 dark:border-brand-dark bg-white dark:bg-brand-darker"
            />
          </label>
        </div>
      </div>
    </div>
  );
};

export default SerpSnippet;
