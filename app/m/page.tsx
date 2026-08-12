// @ts-nocheck
"use client";
// The Android build's entire UI: one search box, one score, one issue list.
// It talks to the same Rust crawler commands as the desktop deep crawler but
// keeps its own tiny state — none of the desktop's 73-column machinery.
import { useEffect, useRef, useState } from "react";
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
  why: string;
  fix: string;
  urls: string[];
};

// How many affected URLs each issue card keeps for the expandable list. The
// count stays exact; only the list is capped so a 50k-page crawl can't blow
// up the phone's memory.
const URL_CAP = 80;

// One place that turns raw crawler pages into the mobile verdict. Weights are
// per-affected-page ratios so a 10-page site and a 10k-page site score alike.
function analyse(pages: any[]): { score: number; issues: Issue[] } {
  const total = pages.length || 1;
  const issues: Issue[] = [];

  const status = (p) => Number(p?.status_code) || 0;
  const title = (p) => p?.title?.[0]?.title || "";
  const desc = (p) => p?.description || "";
  const h1 = (p) => p?.headings?.h1?.[0] || "";
  const words = (p) => Number(p?.word_count) || 0;
  const indexable = (p) => (p?.indexability?.indexability ?? 1) >= 0.5;
  const urlOf = (p) => p?.url || "";

  const add = (key, title, matched, severity, why, fix) => {
    if (matched.length > 0)
      issues.push({
        key, title, severity, why, fix,
        count: matched.length,
        urls: matched.map(urlOf).filter(Boolean).slice(0, URL_CAP),
      });
  };

  add("broken", "صفحات خراب (4xx/5xx)",
    pages.filter((p) => status(p) >= 400), "critical",
    "کاربر و ربات گوگل هر دو به بن‌بست می‌خورند؛ اعتبار لینک‌ها هدر می‌رود، بودجه‌ی کراول تلف می‌شود و تجربه‌ی کاربری و رتبه آسیب می‌بیند.",
    "لینک‌های داخلی به این آدرس‌ها را اصلاح کنید؛ اگر صفحه جای دیگری رفته، ریدایرکت 301 به مقصد درست بدهید و اگر واقعاً حذف شده، از لینک‌دهی به آن دست بردارید.");

  add("noTitle", "صفحه بدون تایتل",
    pages.filter((p) => status(p) < 300 && !title(p)), "critical",
    "تایتل مهم‌ترین سیگنال موضوع صفحه برای گوگل و اولین چیزی است که در نتایج دیده می‌شود؛ بدون آن گوگل خودش چیزی می‌سازد و CTR سقوط می‌کند.",
    "برای هر صفحه یک تگ <title> یکتا و توصیفی (حدود ۵۰ تا ۶۰ کاراکتر) بنویسید که کلیدواژه‌ی اصلی اول آن باشد.");

  {
    const seen = new Map();
    for (const p of pages) { const t = title(p); if (t) seen.set(t, (seen.get(t) || 0) + 1); }
    add("dupTitle", "تایتل تکراری",
      pages.filter((p) => title(p) && seen.get(title(p)) > 1), "warning",
      "وقتی چند صفحه یک تایتل دارند، گوگل نمی‌داند کدام را برای کوئری نشان دهد؛ صفحات با هم رقابت می‌کنند (کانیبالیزیشن) و هیچ‌کدام خوب رتبه نمی‌گیرند.",
      "هر صفحه باید تایتل مخصوص خودش را داشته باشد؛ اگر دو صفحه واقعاً یک موضوع‌اند، یکی را canonical یا ادغام کنید.");
  }

  add("longTitle", "تایتل بلندتر از ۶۰ کاراکتر",
    pages.filter((p) => title(p).length > 60), "notice",
    "گوگل حدود ۶۰۰ پیکسل اول تایتل را نمایش می‌دهد؛ باقی‌اش بریده می‌شود و پیام صفحه ناقص به کاربر می‌رسد.",
    "تایتل را زیر ۶۰ کاراکتر نگه دارید و مهم‌ترین کلمات را ابتدای آن بیاورید.");

  add("noDesc", "صفحه بدون توضیحات متا",
    pages.filter((p) => status(p) < 300 && !desc(p)), "warning",
    "بدون meta description گوگل یک تکه‌ی تصادفی از متن صفحه را نشان می‌دهد؛ اسنیپت غیرجذاب یعنی کلیک کمتر، حتی با رتبه‌ی خوب.",
    "برای هر صفحه توضیح ۷۰ تا ۱۶۰ کاراکتری بنویسید که مزیت صفحه را بگوید و به کلیک دعوت کند.");

  add("noH1", "صفحه بدون H1",
    pages.filter((p) => status(p) < 300 && !h1(p)), "warning",
    "H1 ساختار محتوایی صفحه را به گوگل و اسکرین‌ریدرها می‌گوید؛ نبودش درک موضوع صفحه را سخت‌تر می‌کند.",
    "هر صفحه دقیقاً یک H1 داشته باشد که موضوع اصلی را روشن بگوید (می‌تواند با تایتل فرق کند).");

  add("nonIndex", "صفحه غیرقابل ایندکس",
    pages.filter((p) => status(p) < 300 && !indexable(p)), "warning",
    "این صفحات با noindex یا robots از ایندکس گوگل بیرون‌اند؛ اگر عمدی نباشد یعنی محتوایتان اصلاً در نتایج ظاهر نمی‌شود.",
    "اگر صفحه باید در گوگل باشد تگ noindex یا قانون robots را بردارید؛ اگر عمدی است، لینک‌دهی داخلی به آن را کم کنید.");

  add("thin", "محتوای کم (زیر ۳۰۰ کلمه)",
    pages.filter((p) => status(p) < 300 && words(p) > 0 && words(p) < 300), "notice",
    "صفحات کم‌محتوا به‌سختی برای کوئری‌ها رقابت می‌کنند و در حجم زیاد، کیفیت کل سایت را از نظر گوگل پایین می‌آورند.",
    "یا محتوای واقعی و مفید اضافه کنید، یا چند صفحه‌ی کم‌محتوای هم‌موضوع را در یک صفحه‌ی کامل ادغام و ریدایرکت کنید.");

  add("redirects", "ریدایرکت داخلی",
    pages.filter((p) => status(p) >= 300 && status(p) < 400), "notice",
    "هر پرش ریدایرکت زمان بارگذاری اضافه می‌کند و بخشی از اعتبار لینک در طول زنجیره از دست می‌رود.",
    "لینک‌های داخلی را مستقیم به آدرس نهایی بزنید تا کاربر و ربات از ریدایرکت رد نشوند.");

  // Score: start at 100, subtract per-issue penalties scaled by how much of
  // the site each issue touches. Critical hits ~4× harder than notices.
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
  const [openKey, setOpenKey] = useState<string | null>(null);

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
    setOpenKey(null);
    setPhase("crawling");

    // Browser-preview demo only: outside Tauri there is no crawler, so with
    // ?demo in the URL we animate a sample verdict instead. Inside the real
    // app __TAURI_INTERNALS__ is genuine (no __shim) and this never runs.
    const internals = (window as any).__TAURI_INTERNALS__;
    const inRealApp = internals && !internals.__shim;
    if (!inRealApp && new URLSearchParams(location.search).has("demo")) {
      let n = 0;
      const t = setInterval(() => { n += Math.ceil(Math.random() * 9); setCount(n); }, 120);
      setTimeout(() => {
        clearInterval(t);
        setCount(137);
        const base = domain.replace(/\/$/, "");
        const mk = (u, status, title, desc, h1, words, ix = 1) => ({
          url: `${base}${u}`,
          status_code: status, title: [{ title }], description: desc,
          headings: { h1: h1 ? [h1] : [] }, word_count: words,
          indexability: { indexability: ix },
        });
        const pages = [
          ...Array.from({ length: 112 }, (_, i) => mk(`/blog/post-${i}`, 200, `مقاله ${i}`, "توضیح", "عنوان", 700)),
          mk("/services/old-page", 404, "", "", "", 0),
          mk("/product/legacy-13", 404, "", "", "", 0),
          mk("/tag/قدیمی", 404, "", "", "", 0),
          mk("/wp-content/broken.css", 404, "", "", "", 0),
          mk("/fa/contact-old", 404, "", "", "", 0),
          mk("/api/feed", 500, "", "", "", 0),
          mk("/portfolio/a", 200, "نمونه‌کار", "", "عنوان", 500),
          mk("/portfolio/b", 200, "نمونه‌کار", "", "عنوان", 480),
          mk("/portfolio/c", 200, "نمونه‌کار", "", "عنوان", 450),
          mk("/about", 200, "درباره‌ی ما — آژانس دیجیتال مارکتینگ آن‌وبز و خدمات سئو", "توضیح", "عنوان", 900),
          mk("/faq", 200, "سوالات متداول", "", "", 380),
          mk("/landing/off", 200, "لندینگ", "توضیح", "عنوان", 120, 0),
          mk("/news/1", 200, "خبر اول", "توضیح", "عنوان", 150),
          mk("/news/2", 200, "خبر دوم", "توضیح", "عنوان", 90),
        ];
        setResult(analyse(pages));
        setPhase("done");
      }, 2600);
      return;
    }

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
            className="flex-1 min-w-0 px-4 py-4 text-[15px] outline-none bg-transparent text-left"
            style={{ color: NAVY_DEEP }}
          />
          <button
            onClick={start}
            disabled={phase === "crawling" || !url.trim()}
            className="px-6 shrink-0 font-bold text-white text-sm disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${NAVY} 0%, ${ACCENT} 100%)` }}>
            {phase === "crawling" ? "..." : "تحلیل"}
          </button>
        </div>
        <p className="text-center text-[11px] mt-3 leading-5" style={{ color: "#64748B" }}>
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
                const open = openKey === issue.key;
                return (
                  <motion.div key={issue.key}
                    initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.05 }}
                    className="rounded-2xl bg-white overflow-hidden"
                    style={{ boxShadow: "0 8px 24px rgba(30,58,111,0.07)" }}>

                    {/* Card header — tap to expand */}
                    <button
                      onClick={() => setOpenKey(open ? null : issue.key)}
                      className="w-full text-right p-4 active:bg-slate-50">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 min-w-0">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            className={`shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
                            style={{ color: "#94A3B8" }}>
                            <path d="M9 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.4"
                              strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span className="text-[13px] font-bold truncate" style={{ color: NAVY_DEEP }}>
                            {issue.title}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0 mr-2">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={{ background: sv.bg, color: sv.fg }}>{sv.label}</span>
                          <span className="text-sm font-extrabold tabular-nums" style={{ color: sv.fg }}>
                            {issue.count.toLocaleString("fa-IR")}
                          </span>
                        </span>
                      </div>
                    </button>

                    {/* Expanded body: why + fix + affected URLs */}
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: "easeOut" }}>
                          <div className="px-4 pb-4 space-y-3">
                            <div className="rounded-xl p-3" style={{ background: "#F8FAFC" }}>
                              <div className="text-[11px] font-bold mb-1" style={{ color: sv.fg }}>
                                چه مشکلی ایجاد می‌کند؟
                              </div>
                              <p className="text-[11.5px] leading-5" style={{ color: "#475569" }}>
                                {issue.why}
                              </p>
                            </div>
                            <div className="rounded-xl p-3" style={{ background: "#F0FDF4" }}>
                              <div className="text-[11px] font-bold mb-1" style={{ color: "#16A34A" }}>
                                راه‌حل
                              </div>
                              <p className="text-[11.5px] leading-5" style={{ color: "#475569" }}>
                                {issue.fix}
                              </p>
                            </div>
                            {issue.urls.length > 0 && (
                              <div>
                                <div className="text-[11px] font-bold mb-1.5" style={{ color: NAVY_DEEP }}>
                                  آدرس‌های درگیر
                                  {issue.count > issue.urls.length &&
                                    ` (${issue.urls.length.toLocaleString("fa-IR")} از ${issue.count.toLocaleString("fa-IR")})`}
                                </div>
                                <div dir="ltr"
                                  className="rounded-xl border border-slate-100 divide-y divide-slate-50 max-h-52 overflow-y-auto">
                                  {issue.urls.map((u) => (
                                    <div key={u}
                                      onClick={() => navigator.clipboard?.writeText(u)}
                                      className="px-3 py-2 text-[10.5px] font-mono truncate text-left active:bg-slate-50"
                                      style={{ color: ACCENT }}
                                      title="لمس کن تا کپی شود">
                                      {u}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>

            <button onClick={() => { setPhase("idle"); setResult(null); setUrl(""); setOpenKey(null); }}
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
