// @ts-nocheck
"use client";
// The Android build's entire UI: one search box, one score, one issue list.
// It talks to the same Rust crawler commands as the desktop deep crawler but
// keeps its own tiny state — none of the desktop's 73-column machinery.
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { motion, AnimatePresence } from "framer-motion";

const NAVY = "#1E3A6F";
const NAVY_DEEP = "#16294F";
const ACCENT = "#2B6CC4";
const CANVAS = "#EEF2F9";

type Issue = {
  key: string;
  title: string;
  count: number;
  severity: "critical" | "warning" | "notice";
  fix: string;
};

// One place that turns raw crawler pages into the mobile verdict. Weights are
// per-affected-page ratios so a 10-page site and a 10k-page site score alike.
function analyse(pages: any[]): { score: number; issues: Issue[] } {
  const total = pages.length || 1;
  const issues: Issue[] = [];
  const add = (key, title, count, severity, fix) => {
    if (count > 0) issues.push({ key, title, count, severity, fix });
  };

  const status = (p) => Number(p?.status_code) || 0;
  const title = (p) => p?.title?.[0]?.title || "";
  const desc = (p) => p?.description || "";
  const h1 = (p) => p?.headings?.h1?.[0] || "";
  const words = (p) => Number(p?.word_count) || 0;
  const indexable = (p) => (p?.indexability?.indexability ?? 1) >= 0.5;

  const broken = pages.filter((p) => status(p) >= 400).length;
  add("broken", "صفحات خراب (4xx/5xx)", broken, "critical",
    "لینک‌های شکسته را اصلاح یا به مقصد درست ریدایرکت 301 کنید.");

  const noTitle = pages.filter((p) => status(p) < 300 && !title(p)).length;
  add("noTitle", "صفحه بدون تایتل", noTitle, "critical",
    "برای هر صفحه یک تگ <title> یکتا و توصیفی بنویسید.");

  const seen = new Map();
  for (const p of pages) { const t = title(p); if (t) seen.set(t, (seen.get(t) || 0) + 1); }
  const dupTitles = [...seen.values()].filter((n) => n > 1).reduce((a, n) => a + n, 0);
  add("dupTitle", "تایتل تکراری", dupTitles, "warning",
    "تایتل هر صفحه باید یکتا باشد — صفحات هم‌تایتل را بازنویسی کنید.");

  const longTitle = pages.filter((p) => title(p).length > 60).length;
  add("longTitle", "تایتل بلندتر از ۶۰ کاراکتر", longTitle, "notice",
    "تایتل‌های بلند در نتایج گوگل بریده می‌شوند — زیر ۶۰ کاراکتر نگه دارید.");

  const noDesc = pages.filter((p) => status(p) < 300 && !desc(p)).length;
  add("noDesc", "صفحه بدون توضیحات متا", noDesc, "warning",
    "برای هر صفحه یک meta description جذاب ۷۰ تا ۱۶۰ کاراکتری بنویسید.");

  const noH1 = pages.filter((p) => status(p) < 300 && !h1(p)).length;
  add("noH1", "صفحه بدون H1", noH1, "warning",
    "هر صفحه دقیقاً یک H1 داشته باشد که موضوع اصلی را بگوید.");

  const nonIndex = pages.filter((p) => status(p) < 300 && !indexable(p)).length;
  add("nonIndex", "صفحه غیرقابل ایندکس", nonIndex, "warning",
    "اگر این صفحات باید در گوگل باشند، noindex/robots را بردارید.");

  const thin = pages.filter((p) => status(p) < 300 && words(p) > 0 && words(p) < 300).length;
  add("thin", "محتوای کم (زیر ۳۰۰ کلمه)", thin, "notice",
    "صفحات کم‌محتوا را ادغام کنید یا محتوای واقعی و مفید اضافه کنید.");

  const redirects = pages.filter((p) => status(p) >= 300 && status(p) < 400).length;
  add("redirects", "ریدایرکت داخلی", redirects, "notice",
    "لینک‌های داخلی را مستقیم به مقصد نهایی بزنید، نه به ریدایرکت.");

  // Score: start at 100, subtract per-issue penalties scaled by how much of
  // the site each issue touches. Critical hits 3× harder than notices.
  const weight = { critical: 45, warning: 25, notice: 10 };
  let penalty = 0;
  for (const i of issues) penalty += weight[i.severity] * Math.min(1, i.count / total);
  const score = Math.max(0, Math.round(100 - penalty));

  const order = { critical: 0, warning: 1, notice: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
  return { score, issues };
}

function grade(score: number) {
  if (score >= 90) return { label: "عالی", color: "#16A34A" };
  if (score >= 75) return { label: "خوب", color: "#65A30D" };
  if (score >= 50) return { label: "متوسط", color: "#D97706" };
  return { label: "ضعیف", color: "#DC2626" };
}

const SEV = {
  critical: { label: "بحرانی", bg: "#FEE2E2", fg: "#DC2626" },
  warning: { label: "هشدار", bg: "#FEF3C7", fg: "#D97706" },
  notice: { label: "نکته", bg: "#E0EAFB", fg: ACCENT },
};

export default function MobilePage() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<"idle" | "crawling" | "done">("idle");
  const [count, setCount] = useState(0);
  const pagesRef = useRef<any[]>([]);
  const [result, setResult] = useState<{ score: number; issues: Issue[] } | null>(null);

  // Collect raw crawl batches straight off the event bus; the heavy Zustand
  // store and its table pipelines never load on mobile.
  useEffect(() => {
    let un1, un2;
    listen("crawl_result", (e) => {
      const batch = e?.payload?.results || (e?.payload?.result ? [e.payload.result] : []);
      if (batch.length) {
        pagesRef.current.push(...batch);
        setCount(pagesRef.current.length);
      }
    }).then((u) => (un1 = u));
    listen("crawl_complete", () => {
      setResult(analyse(pagesRef.current));
      setPhase("done");
    }).then((u) => (un2 = u));
    return () => { un1?.(); un2?.(); };
  }, []);

  const start = async () => {
    let domain = url.trim();
    if (!domain) return;
    if (!/^https?:\/\//i.test(domain)) domain = "https://" + domain;
    pagesRef.current = [];
    setCount(0);
    setResult(null);
    setPhase("crawling");
    try {
      await invoke("domain_crawl_command", { domain });
      // crawl_complete usually fires first; this is the fallback.
      if (pagesRef.current.length) {
        setResult(analyse(pagesRef.current));
        setPhase("done");
      }
    } catch {
      setResult(analyse(pagesRef.current));
      setPhase(pagesRef.current.length ? "done" : "idle");
    }
  };

  const g = result ? grade(result.score) : null;
  const R = 52, C = 2 * Math.PI * R;

  return (
    <div dir="rtl" className="min-h-screen w-full flex flex-col items-center px-5 pb-10"
      style={{ background: `radial-gradient(80% 50% at 50% 0%, ${ACCENT}18 0%, transparent 60%), ${CANVAS}` }}>

      {/* Brand */}
      <div className="flex flex-col items-center mt-14 mb-8">
        <img src="/icon.png" alt="" className="w-16 h-16 mb-3"
          style={{ filter: "drop-shadow(0 6px 14px rgba(30,58,111,0.2))" }} />
        <div className="flex items-baseline gap-2" dir="ltr">
          <span className="text-2xl font-bold" style={{ color: NAVY_DEEP }}>onwebs</span>
          <span className="text-xs font-semibold" style={{ color: ACCENT }}>SEO & GEO</span>
        </div>
      </div>

      {/* Search */}
      <div className="w-full max-w-md">
        <div className="flex items-stretch rounded-2xl bg-white overflow-hidden"
          style={{ boxShadow: "0 12px 32px rgba(30,58,111,0.10)" }}>
          <input
            dir="ltr"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && phase !== "crawling" && start()}
            placeholder="example.com"
            className="flex-1 px-4 py-4 text-[15px] outline-none bg-transparent text-left"
            style={{ color: NAVY_DEEP }}
          />
          <button
            onClick={start}
            disabled={phase === "crawling" || !url.trim()}
            className="px-6 font-bold text-white text-sm disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${ACCENT} 100%)` }}>
            {phase === "crawling" ? "..." : "تحلیل"}
          </button>
        </div>
        <p className="text-center text-[11px] mt-3" style={{ color: "#64748B" }}>
          آدرس سایتت را بزن تا کامل کراول و نمره‌گذاری شود — رایگان و روی خود گوشی
        </p>
      </div>

      {/* Crawling state */}
      <AnimatePresence>
        {phase === "crawling" && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center mt-12">
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
              className="w-12 h-12 rounded-full mb-5"
              style={{ border: `3px solid ${ACCENT}30`, borderTopColor: ACCENT }} />
            <div className="text-3xl font-bold tabular-nums" style={{ color: NAVY_DEEP }}>{count}</div>
            <div className="text-xs mt-1" style={{ color: "#64748B" }}>صفحه کراول شد…</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result */}
      <AnimatePresence>
        {phase === "done" && result && (
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md mt-10">

            {/* Score ring */}
            <div className="flex flex-col items-center rounded-3xl bg-white py-8 px-6"
              style={{ boxShadow: "0 16px 40px rgba(30,58,111,0.10)" }}>
              <div className="relative w-[128px] h-[128px]">
                <svg width="128" height="128" viewBox="0 0 128 128" className="-rotate-90">
                  <circle cx="64" cy="64" r={R} fill="none" stroke="#E2E8F0" strokeWidth="10" />
                  <motion.circle cx="64" cy="64" r={R} fill="none"
                    stroke={g.color} strokeWidth="10" strokeLinecap="round"
                    strokeDasharray={C}
                    initial={{ strokeDashoffset: C }}
                    animate={{ strokeDashoffset: C * (1 - result.score / 100) }}
                    transition={{ duration: 1.1, ease: "easeOut" }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-4xl font-extrabold tabular-nums" style={{ color: NAVY_DEEP }}>
                    {result.score}
                  </span>
                  <span className="text-[11px] font-bold" style={{ color: g.color }}>{g.label}</span>
                </div>
              </div>
              <div className="text-xs mt-4" style={{ color: "#64748B" }}>
                نمره‌ی سئو از ۱۰۰ · {count} صفحه بررسی شد
              </div>
            </div>

            {/* Issues */}
            <div className="mt-6 space-y-3">
              {result.issues.length === 0 && (
                <div className="rounded-2xl bg-white p-5 text-center text-sm font-bold"
                  style={{ color: "#16A34A", boxShadow: "0 8px 24px rgba(30,58,111,0.08)" }}>
                  🎉 مشکلی پیدا نشد — سایتت تمیز است
                </div>
              )}
              {result.issues.map((issue, i) => {
                const sv = SEV[issue.severity];
                return (
                  <motion.div key={issue.key}
                    initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.06 }}
                    className="rounded-2xl bg-white p-4"
                    style={{ boxShadow: "0 8px 24px rgba(30,58,111,0.07)" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[13px] font-bold" style={{ color: NAVY_DEEP }}>
                        {issue.title}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: sv.bg, color: sv.fg }}>{sv.label}</span>
                        <span className="text-sm font-extrabold tabular-nums" style={{ color: sv.fg }}>
                          {issue.count.toLocaleString("fa-IR")}
                        </span>
                      </span>
                    </div>
                    <p className="text-[11.5px] leading-5" style={{ color: "#64748B" }}>{issue.fix}</p>
                  </motion.div>
                );
              })}
            </div>

            <button onClick={() => { setPhase("idle"); setResult(null); setUrl(""); }}
              className="w-full mt-6 py-3.5 rounded-2xl text-sm font-bold text-white"
              style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${ACCENT} 100%)` }}>
              تحلیل سایت دیگر
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
