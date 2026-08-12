// @ts-nocheck
"use client";

// Screaming Frog's Crawl Config, cut down to the settings this crawler
// actually honours. Two-column layout like SF: a navigation list on the left,
// the selected section on the right, with a validity indicator and Cancel/OK
// along the bottom.
//
// Everything here writes through `update_settings_command`, so a change takes
// effect on the next crawl — unlike the old GeneralSettings screen, which
// rendered controls that were wired to nothing.

import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { CheckCircle2, AlertCircle, Filter, Ban, Bot, Gauge, ListChecks } from "lucide-react";

const SECTIONS = [
  { key: "listMode", label: "Mode", icon: ListChecks },
  { key: "include", label: "Include", icon: Filter },
  { key: "exclude", label: "Exclude", icon: Ban },
  { key: "userAgent", label: "User-Agent", icon: Bot },
  { key: "speed", label: "Speed", icon: Gauge },
];


// Crawling your own site and crawling someone else's are different jobs, and
// the numbers that make one safe make the other painfully slow. Each profile
// is a coherent set rather than a slider, because the four values only make
// sense together: high concurrency with a long delay is still slow, and no
// delay with a huge retry budget still stalls on a dead host.
const SPEED_PROFILES = [
  {
    key: "polite",
    label: "محتاط",
    hint: "برای سایت دیگران — کندترین و بی‌آزارترین",
    values: { concurrent: 5, baseDelay: 1500, maxRetries: 5, clientTimeout: 60 },
    rate: "~۳ آدرس در ثانیه",
  },
  {
    key: "balanced",
    label: "متعادل",
    hint: "پیش‌فرض منطقی برای بیشتر سایت‌ها",
    values: { concurrent: 10, baseDelay: 200, maxRetries: 3, clientTimeout: 30 },
    rate: "~۱۵ آدرس در ثانیه",
  },
  {
    key: "fast",
    label: "سریع",
    hint: "برای سایت خودت — بدون تأخیر",
    values: { concurrent: 16, baseDelay: 0, maxRetries: 2, clientTimeout: 20 },
    rate: "~۳۰ آدرس در ثانیه",
  },
];

const UA_PRESETS = [
  {
    label: "Onwebs SEO & GEO (پیش‌فرض)",
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) OnwebsSEO/1.0 Safari/537.36",
  },
  {
    label: "Googlebot (Desktop)",
    value:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Safari/537.36",
  },
  {
    label: "Googlebot (Smartphone)",
    value:
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  {
    label: "Chrome (Desktop)",
    value:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  },
  { label: "Bingbot", value: "Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)" },
];

/** Reports the first invalid regex so the user sees it before saving. */
function firstBadPattern(text: string): string | null {
  for (const line of text.split("\n")) {
    const p = line.trim();
    if (!p) continue;
    try {
      new RegExp(p);
    } catch {
      return p;
    }
  }
  return null;
}

const CrawlConfig = ({ onClose }: any) => {
  const [section, setSection] = useState("exclude");
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [userAgent, setUserAgent] = useState(UA_PRESETS[0].value);
  const [concurrent, setConcurrent] = useState(5);
  const [baseDelay, setBaseDelay] = useState(1500);
  const [maxDepth, setMaxDepth] = useState(50);
  const [maxUrls, setMaxUrls] = useState(100000);
  const [maxRetries, setMaxRetries] = useState(2);
  const [clientTimeout, setClientTimeout] = useState(20);
  const [listMode, setListMode] = useState(false);
  const [listUrls, setListUrls] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s: any = await invoke("get_system");
        if (!s) return;
        setInclude((s.include_patterns || []).join("\n"));
        setExclude((s.exclude_patterns || []).join("\n"));
        setListMode(Boolean(s.list_mode));
        setListUrls((s.list_urls || []).join("\n"));
        if (typeof s.max_retries === "number") setMaxRetries(s.max_retries);
        if (typeof s.client_timeout === "number") setClientTimeout(s.client_timeout);
        if (Array.isArray(s.user_agents) && s.user_agents[0])
          setUserAgent(s.user_agents[0]);
        if (typeof s.concurrent_requests === "number") setConcurrent(s.concurrent_requests);
        if (typeof s.base_delay === "number") setBaseDelay(s.base_delay);
        if (typeof s.max_depth === "number") setMaxDepth(s.max_depth);
        if (typeof s.max_urls_per_domain === "number") setMaxUrls(s.max_urls_per_domain);
      } catch (e) {
        console.error("Failed to read settings", e);
      }
    })();
  }, []);

  const badInclude = useMemo(() => firstBadPattern(include), [include]);
  const badExclude = useMemo(() => firstBadPattern(exclude), [exclude]);
  const valid = !badInclude && !badExclude;

  const save = async () => {
    if (!valid) {
      toast.error(`الگوی نامعتبر: ${badInclude || badExclude}`);
      return;
    }
    setSaving(true);
    try {
      // The backend accepts a newline-separated string for these two and
      // splits them itself, so the textarea content goes across as-is.
      await invoke("update_settings_command", {
        updates: JSON.stringify({
          list_mode: listMode,
          list_urls: listUrls
            .split("\n")
            .map((l: string) => l.trim())
            .filter(Boolean),
          include_patterns: include,
          exclude_patterns: exclude,
          user_agents: [userAgent],
          concurrent_requests: concurrent,
          base_delay: baseDelay,
          max_depth: maxDepth,
          max_urls_per_domain: maxUrls,
          max_retries: maxRetries,
          client_timeout: clientTimeout,
          // A delay floor above zero would quietly undo the fast profile.
          min_crawl_delay: baseDelay === 0 ? 0 : Math.min(baseDelay, 500),
        }),
      });
      toast.success("تنظیمات ذخیره شد — از کراول بعدی اعمال می‌شود");
      onClose?.();
    } catch (e) {
      console.error(e);
      toast.error("ذخیره تنظیمات ناموفق بود");
    } finally {
      setSaving(false);
    }
  };

  const PatternEditor = ({ value, onChange, bad, title, blurb, examples }: any) => (
    <>
      <h2 className="text-sm font-bold text-slate-800 dark:text-white mb-1">
        {title}
      </h2>
      <p className="text-xs text-slate-500 dark:text-white/50 mb-3 leading-relaxed">
        {blurb}
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        spellCheck={false}
        placeholder={examples.join("\n")}
        className="w-full font-mono text-xs border rounded p-2 dark:border-brand-dark bg-white dark:bg-brand-darker"
        style={{ direction: "ltr", textAlign: "left" }}
      />
      {bad ? (
        <p className="mt-2 text-xs text-rose-500 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          الگوی نامعتبر: <code className="font-mono">{bad}</code>
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-400">
          هر خط یک الگوی regex. روی کل URL تست می‌شود.
        </p>
      )}
    </>
  );

  return (
    <div className="flex flex-col h-[520px] text-xs">
      <div className="flex flex-1 min-h-0">
        {/* Navigation */}
        <div className="w-52 shrink-0 border-r dark:border-brand-dark overflow-y-auto py-2">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left ${
                  section === s.key
                    ? "bg-brand-bright text-white"
                    : "hover:bg-black/5 dark:hover:bg-white/5 text-slate-600 dark:text-white/70"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4">
          <div className="text-[11px] text-slate-400 mb-3">
            Crawl Config › {SECTIONS.find((s) => s.key === section)?.label}
          </div>

          {section === "exclude" && (
            <PatternEditor
              value={exclude}
              onChange={setExclude}
              bad={badExclude}
              title="Exclude"
              blurb="هر URL که با یکی از این الگوها بخواند، اصلاً کراول نمی‌شود. برای بیرون نگه داشتن سبد خرید، فیلترها و تقویم‌های بی‌پایان."
              examples={["/cart/", "\\?sessionid=", "/tag/", "\\.pdf$"]}
            />
          )}

          {section === "listMode" && (
            <div className="space-y-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={listMode}
                  onChange={(e) => setListMode(e.target.checked)}
                  className="mt-1"
                />
                <span>
                  <span className="font-bold">List mode</span>
                  <span className="block text-[11px] text-slate-500 dark:text-white/50 mt-0.5">
                    فقط آدرس‌های زیر کراول می‌شوند و هیچ لینکی از داخلشان دنبال
                    نمی‌شود. برای بررسی یک مجموعه‌ی مشخص از صفحات، به‌جای کشف کل
                    سایت. سایت‌مپ هم در این حالت خوانده نمی‌شود.
                  </span>
                </span>
              </label>

              <textarea
                value={listUrls}
                onChange={(e) => setListUrls(e.target.value)}
                disabled={!listMode}
                rows={12}
                dir="ltr"
                placeholder={"https://example.com/page-1\nhttps://example.com/page-2"}
                className="w-full font-mono text-[11px] p-2 rounded border dark:border-white/10 bg-white dark:bg-brand-darker disabled:opacity-40"
                style={{ textAlign: "left" }}
              />

              <p className="text-[11px] text-slate-500 dark:text-white/50">
                یک آدرس در هر خط.
                {listMode && listUrls.trim() && (
                  <span className="font-mono text-brand-bright">
                    {" "}
                    {listUrls.split("\n").filter((l: string) => l.trim()).length} آدرس
                  </span>
                )}
              </p>
            </div>
          )}

          {section === "include" && (
            <PatternEditor
              value={include}
              onChange={setInclude}
              bad={badInclude}
              title="Include"
              blurb="اگر خالی باشد همه‌جا کراول می‌شود. اگر پر باشد، فقط URLهایی که با یکی از این الگوها بخوانند کراول می‌شوند — برای محدود کردن کراول به یک بخش سایت. Exclude بر Include اولویت دارد."
              examples={["/blog/", "^https://onwebs\\.ir/en/"]}
            />
          )}

          {section === "userAgent" && (
            <>
              <h2 className="text-sm font-bold text-slate-800 dark:text-white mb-1">
                User-Agent
              </h2>
              <p className="text-xs text-slate-500 dark:text-white/50 mb-3">
                هویتی که کراولر به سرور اعلام می‌کند. بعضی سایت‌ها به Googlebot
                محتوای متفاوتی می‌دهند.
              </p>
              <select
                value={UA_PRESETS.some((p) => p.value === userAgent) ? userAgent : "custom"}
                onChange={(e) => {
                  if (e.target.value !== "custom") setUserAgent(e.target.value);
                }}
                className="w-full border rounded px-2 py-1.5 mb-2 dark:border-brand-dark bg-white dark:bg-brand-darker"
              >
                {UA_PRESETS.map((p) => (
                  <option key={p.label} value={p.value}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">سفارشی</option>
              </select>
              <textarea
                value={userAgent}
                onChange={(e) => setUserAgent(e.target.value)}
                rows={4}
                spellCheck={false}
                className="w-full font-mono text-[11px] border rounded p-2 dark:border-brand-dark bg-white dark:bg-brand-darker"
                style={{ direction: "ltr", textAlign: "left" }}
              />
            </>
          )}

          {section === "speed" && (
            <>
              <h2 className="text-sm font-bold text-slate-800 dark:text-white mb-1">
                Speed &amp; Limits
              </h2>
              <p className="text-xs text-slate-500 dark:text-white/50 mb-4">
                سرعت کراول و سقف‌هایش. مقادیر بالا سایت‌های کوچک را تحت فشار
                می‌گذارد و ممکن است باعث بلاک شدن شود.
              </p>
              <div className="grid grid-cols-3 gap-2 mb-5">
                {SPEED_PROFILES.map((p) => {
                  const active =
                    concurrent === p.values.concurrent &&
                    baseDelay === p.values.baseDelay;
                  return (
                    <button
                      key={p.key}
                      onClick={() => {
                        setConcurrent(p.values.concurrent);
                        setBaseDelay(p.values.baseDelay);
                        setMaxRetries(p.values.maxRetries);
                        setClientTimeout(p.values.clientTimeout);
                      }}
                      className={`text-right p-3 rounded-lg border transition-colors ${
                        active
                          ? "border-brand-bright bg-brand-bright/10"
                          : "border-slate-200 dark:border-white/10 hover:border-brand-bright/50"
                      }`}
                    >
                      <div className="font-bold text-[13px] text-slate-800 dark:text-white">
                        {p.label}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-white/50 mt-0.5 leading-snug">
                        {p.hint}
                      </div>
                      <div className="text-[10px] font-mono text-brand-bright mt-1">
                        {p.rate}
                      </div>
                    </button>
                  );
                })}
              </div>

              {[
                { label: "درخواست هم‌زمان", value: concurrent, set: setConcurrent, min: 1, max: 50, hint: "پیش‌فرض ۱۶" },
                { label: "تأخیر پایه (میلی‌ثانیه)", value: baseDelay, set: setBaseDelay, min: 0, max: 30000, hint: "۰ یعنی بدون تأخیر" },
                { label: "حداکثر تلاش مجدد", value: maxRetries, set: setMaxRetries, min: 0, max: 10, hint: "پیش‌فرض ۲ — عدد بالا یک URL مرده را دقایقی نگه می‌دارد" },
                { label: "مهلت پاسخ (ثانیه)", value: clientTimeout, set: setClientTimeout, min: 5, max: 120, hint: "پیش‌فرض ۲۰" },
                { label: "حداکثر عمق", value: maxDepth, set: setMaxDepth, min: 1, max: 100, hint: "پیش‌فرض ۵۰" },
                { label: "حداکثر URL در هر دامنه", value: maxUrls, set: setMaxUrls, min: 1, max: 1000000, hint: "پیش‌فرض ۱۰۰٬۰۰۰" },
              ].map((f) => (
                <label key={f.label} className="flex items-center gap-3 mb-3">
                  <span className="w-48 shrink-0 text-slate-600 dark:text-white/70">
                    {f.label}
                  </span>
                  <input
                    type="number"
                    min={f.min}
                    max={f.max}
                    value={f.value}
                    onChange={(e) => f.set(Number(e.target.value))}
                    className="w-32 border rounded px-2 py-1 dark:border-brand-dark bg-white dark:bg-brand-darker"
                  />
                  <span className="text-[11px] text-slate-400">{f.hint}</span>
                </label>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t dark:border-brand-dark shrink-0">
        <span
          className={`flex items-center gap-1.5 ${
            valid ? "text-emerald-500" : "text-rose-500"
          }`}
        >
          {valid ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5" />
          )}
          {valid ? "Valid config" : "الگوی نامعتبر دارد"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded border dark:border-brand-dark text-slate-600 dark:text-white/70 hover:bg-black/5 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!valid || saving}
            className="px-5 py-1.5 rounded bg-brand-bright text-white disabled:opacity-50 hover:opacity-90"
          >
            {saving ? "…" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CrawlConfig;
