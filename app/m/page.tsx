// @ts-nocheck
"use client";
// The Android build's entire UI. It talks to the same Rust crawler commands as
// the desktop deep crawler but keeps its own tiny state — none of the desktop's
// 73-column machinery.
//
// Two rules shape everything below, and breaking either one makes the app feel
// like a different product:
//
//   1. Tapping anything opens a sheet from the bottom. Nothing expands in
//      place, nothing navigates away. One `<Sheet>` renders them all, so the
//      motion, the grabber and the dismiss behaviour cannot drift apart.
//   2. Icons are drawn on the background in one colour. No tinted tiles, no
//      per-category hues — the yellow is the only accent the eye has to track,
//      which is what lets a very dark screen stay readable.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";

// Near-black rather than black: a true #000 makes the OLED edges of a phone
// bleed into the bezel and hides every border we draw.
const INK = "#0A0A0B";
const SURFACE = "#141416";
const RAISED = "#1B1B1E";
const LINE = "#26262A";
const YELLOW = "#F5C518";
const TEXT = "#F4F4F5";
const MUTED = "#8A8A92";

// Severity still needs to be distinguishable, but as text weight rather than
// six competing hues. Only genuine alarm earns a colour of its own.
const SEV = {
  critical: { label: "بحرانی", color: "#F87171" },
  warning: { label: "هشدار", color: YELLOW },
  notice: { label: "توجه", color: MUTED },
};

type Issue = {
  key: string;
  title: string;
  count: number;
  severity: "critical" | "warning" | "notice";
  why: string;
  fix: string;
  urls: string[];
};

// How many affected URLs each issue keeps for its list. The count stays exact;
// only the list is capped so a 50k-page crawl can't blow up the phone's memory.
const URL_CAP = 80;
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
  if (score >= 90) return { label: "عالی", tone: "#4ADE80" };
  if (score >= 75) return { label: "خوب", tone: YELLOW };
  if (score >= 50) return { label: "متوسط", tone: "#FB923C" };
  return { label: "ضعیف", tone: "#F87171" };
}

// One stroke weight, one colour, no fill. Passing a size keeps them optically
// even whether they sit in a row of six or alone above a sheet title.
const Icon = ({ d, size = 22, color = YELLOW, extra = null }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d={d} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    {extra}
  </svg>
);

const PATHS = {
  technical:
    "M10.3 4.3a2 2 0 013.4 0l.6 1a2 2 0 002.2.9l1.1-.3a2 2 0 012.4 2.4l-.3 1.1a2 2 0 00.9 2.2l1 .6a2 2 0 010 3.4l-1 .6a2 2 0 00-.9 2.2l.3 1.1a2 2 0 01-2.4 2.4l-1.1-.3a2 2 0 00-2.2.9l-.6 1a2 2 0 01-3.4 0l-.6-1a2 2 0 00-2.2-.9l-1.1.3a2 2 0 01-2.4-2.4l.3-1.1a2 2 0 00-.9-2.2l-1-.6a2 2 0 010-3.4l1-.6a2 2 0 00.9-2.2l-.3-1.1a2 2 0 012.4-2.4l1.1.3a2 2 0 002.2-.9l.6-1z",
  content: "M7 3h7l5 5v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM14 3v5h5M9 13h6M9 17h4",
  links:
    "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.6-5.6l-1.2 1.2M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.6 5.6l1.2-1.2",
  index: "M11 4.5a6.5 6.5 0 110 13 6.5 6.5 0 010-13zM15.6 15.6l4.7 4.7M8.5 11l1.8 1.8 3.2-3.6",
  speed: "M13 2L4.5 13.5H11L9.5 22 19 10h-6.5L13 2z",
  geo: "M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3z",
  search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3",
  history: "M12 7v5l3.5 2M3.5 12a8.5 8.5 0 102.6-6.1M3.5 5.5V10h4.5",
  profile: "M4.5 20a7.5 7.5 0 0115 0M12 11a4 4 0 100-8 4 4 0 000 8z",
  chevron: "M9 6l6 6-6 6",
  close: "M6 6l12 12M18 6L6 18",
  trash: "M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13",
};

const CATEGORIES = [
  { key: "technical", title: "سئو تکنیکال", desc: "استتوس‌کدها و ساختار فنی",
    more: "صفحات خراب 4xx/5xx، زنجیره‌ی ریدایرکت‌ها، robots.txt و خطاهای سروری — پایه‌ای که بقیه‌ی سئو روی آن می‌ایستد." },
  { key: "content", title: "محتوا", desc: "تایتل، متا و کیفیت متن",
    more: "تایتل‌های تکراری یا بلند، توضیحات متای خالی، H1 و صفحات کم‌محتوا — چیزهایی که مستقیم روی کلیک و رتبه اثر می‌گذارند." },
  { key: "links", title: "لینک‌ها", desc: "لینک شکسته و ریدایرکت",
    more: "لینک‌های داخلی که به صفحه‌ی مرده می‌روند یا از چند ریدایرکت رد می‌شوند، اعتبار و بودجه‌ی کراول را هدر می‌دهند." },
  { key: "index", title: "ایندکس", desc: "دیده‌شدن در گوگل",
    more: "کدام صفحه‌ها ایندکس می‌شوند و کدام‌ها با noindex یا robots بیرون مانده‌اند — تا محتوایی که برایش زحمت کشیدی گم نشود." },
  { key: "speed", title: "سرعت", desc: "زمان پاسخ و حجم صفحه",
    more: "پاسخ کند سرور و صفحات سنگین هم کاربر را می‌پراند هم خزنده‌ی گوگل را — سرعت جزو فاکتورهای رتبه است." },
  { key: "geo", title: "GEO و هوش مصنوعی", desc: "آمادگی برای جستجوی AI",
    more: "ChatGPT و Perplexity هم سایتت را می‌خوانند؛ ساختار تمیز و محتوای قابل استناد یعنی در جواب‌های AI هم دیده شوی." },
];

/** Every panel in the app. Rendered once, driven by whatever `sheet` holds. */
function Sheet({ open, title, subtitle, onClose, children }) {
  // A sheet that stays mounted would keep the page scrollable behind it, which
  // on a phone reads as the sheet being stuck to nothing.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  // Kept mounted for one frame at its closed offset, then slid in by a CSS
  // transition. framer-motion drove this before, and on Android's WebView its
  // animations did not always run: elements stayed at their initial state, so
  // the page opened black and only appeared once a tap forced a re-render.
  // Nothing here needs JavaScript to reach its visible state.
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const id = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(id);
  }, [open]);

  if (!mounted) return null;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[90]"
        style={{
          background: "rgba(0,0,0,0.72)",
          opacity: shown ? 1 : 0,
          transition: "opacity 180ms ease",
        }}
      />
      <div
        className="fixed inset-x-0 bottom-0 z-[91] rounded-t-3xl overflow-hidden flex flex-col"
        style={{
          background: SURFACE,
          borderTop: `1px solid ${LINE}`,
          maxHeight: "88vh",
          boxShadow: "0 -24px 60px rgba(0,0,0,0.6)",
          transform: shown ? "translateY(0)" : "translateY(100%)",
          transition: "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      >
        <div className="pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="h-1 w-10 rounded-full" style={{ background: LINE }} />
        </div>
        <div className="px-5 pb-3 flex items-start gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-extrabold" style={{ color: TEXT }}>{title}</h2>
            {subtitle && (
              <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>{subtitle}</p>
            )}
          </div>
          <button onClick={onClose} aria-label="بستن" className="p-1 -m-1 shrink-0">
            <Icon d={PATHS.close} size={18} color={MUTED} />
          </button>
        </div>
        <div className="px-5 pb-8 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          {children}
        </div>
      </div>
    </>
  );
}

/** Hands a URL to the phone's browser.
 *
 * These are other people's pages: opening them inside the app would leave the
 * visitor stranded in a window with no address bar and no way back.
 */
async function openInBrowser(url: string) {
  if (!url) return;
  try {
    await openExternal(url);
  } catch (error) {
    console.error("Could not open", url, error);
  }
}

/** A URL that opens in the browser when tapped. */
const LinkRow = ({ url }: { url: string }) => (
  <button
    onClick={() => openInBrowser(url)}
    dir="ltr"
    className="w-full text-left text-[11px] px-3 py-2 break-all active:opacity-60 transition-opacity"
    style={{ color: MUTED, borderBottom: `1px solid ${LINE}` }}
  >
    {url}
  </button>
);

/** A tappable row. The whole thing is the target — never just the chevron. */
const Row = ({ icon, title, meta, onClick, right = null }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-3 py-3 text-right active:opacity-60 transition-opacity"
    style={{ borderBottom: `1px solid ${LINE}` }}
  >
    {icon && <Icon d={icon} size={20} />}
    <span className="flex-1 min-w-0">
      <span className="block text-[13px] font-bold truncate" style={{ color: TEXT }}>{title}</span>
      {meta && <span className="block text-[11px] mt-0.5 truncate" style={{ color: MUTED }}>{meta}</span>}
    </span>
    {right}
    <Icon d={PATHS.chevron} size={16} color={MUTED} />
  </button>
);

/** Shown one at a time while a crawl runs.
 *
 * A crawl takes minutes and a spinner says nothing for all of them. These are
 * the findings the crawler actually reports, explained — so the wait teaches
 * the person something about the report they are about to read.
 */
const TIPS = [
  "تایتل هر صفحه باید یکتا باشد. دو صفحه با یک تایتل، گوگل را مجبور می‌کند بین‌شان یکی را انتخاب کند.",
  "توضیحات متا روی رتبه اثر مستقیم ندارد، ولی روی نرخ کلیک دارد — همان جمله‌ای است که در نتایج جستجو خوانده می‌شود.",
  "هر صفحه یک H1 می‌خواهد؛ نه صفر، نه پنج‌تا. H1 می‌گوید این صفحه دربارهٔ چیست.",
  "لینک شکسته دو چیز را هدر می‌دهد: اعتبار لینک‌ها و بودجهٔ خزش گوگل.",
  "صفحهٔ زیر ۳۰۰ کلمه معمولاً برای پاسخ دادن به یک جستجو کافی نیست.",
  "ریدایرکت زنجیره‌ای هر بار کمی از اعتبار را می‌خورد. مستقیم به مقصد نهایی وصل کن.",
  "صفحه‌ای که noindex دارد از نتایج بیرون می‌ماند — حتی اگر بهترین محتوای سایتت باشد.",
  "سرعت پاسخ سرور جزو فاکتورهای رتبه است. کاربر موبایل زودتر از گوگل می‌رود.",
  "تصویر بدون alt هم برای نابینا نامرئی است هم برای جستجوی تصویر گوگل.",
  "ChatGPT و Perplexity هم سایتت را می‌خوانند؛ ساختار تمیز یعنی در جواب‌های AI هم دیده شوی.",
];

export default function MobilePage() {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<"idle" | "crawling" | "done">("idle");
  const [count, setCount] = useState(0);
  const pagesRef = useRef<any[]>([]);
  const [result, setResult] = useState<{ score: number; issues: Issue[] } | null>(null);
  const [tab, setTab] = useState<"history" | "search" | "profile">("search");
  const [history, setHistory] = useState<any[]>([]);
  const [profile, setProfile] = useState<{ name: string; email: string } | null>(null);
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  /** True when the numbers on screen are the browser sample, not a crawl. */
  const [demoSample, setDemoSample] = useState(false);
  /** Why the last crawl could not start, shown instead of failing silently. */
  const [failure, setFailure] = useState<string | null>(null);
  /** True while the site is being measured, before any crawling starts. */
  const [sizing, setSizing] = useState(false);
  /** Findings so far, recomputed as results arrive so the list fills up while
   *  the crawl runs rather than appearing all at once at the end. */
  const [liveIssues, setLiveIssues] = useState<Issue[]>([]);
  const [tip, setTip] = useState(0);

  // The single source of what is on screen above the page: { kind, data }.
  const [sheet, setSheet] = useState<{ kind: string; data?: any } | null>(null);
  const closeSheet = () => setSheet(null);

  // Android's WebView applies algorithmic darkening to any page that has not
  // declared it handles its own theme. Ours is already dark, so that pass
  // inverted it and served a light screen with white text on it — unreadable.
  // Painting the document itself also stops the shell's light background from
  // showing through anywhere the page does not reach.
  useEffect(() => {
    const root = document.documentElement;
    root.style.colorScheme = "dark";
    root.style.background = INK;
    document.body.style.background = INK;
    return () => {
      root.style.colorScheme = "";
      root.style.background = "";
      document.body.style.background = "";
    };
  }, []);

  useEffect(() => {
    try { setHistory(JSON.parse(localStorage.getItem("onwebs.m.history") || "[]")); } catch {}
    try { const p = JSON.parse(localStorage.getItem("onwebs.m.profile") || "null"); if (p) setProfile(p); } catch {}
  }, []);

  const saveToHistory = (domain: string, res, pages: number) => {
    const entry = {
      id: Date.now(),
      domain: domain.replace(/^https?:\/\//, ""),
      date: new Date().toISOString(),
      pages,
      score: res.score,
      issueCount: res.issues.reduce((a, i) => a + i.count, 0),
      result: res,
    };
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, 30);
      try { localStorage.setItem("onwebs.m.history", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    if (phase !== "crawling") return;
    const rotate = setInterval(() => setTip((t) => (t + 1) % TIPS.length), 6000);
    // Re-analysing every result would cost more than the crawl; every couple
    // of seconds is often enough to feel live.
    const grow = setInterval(() => {
      if (pagesRef.current.length) setLiveIssues(analyse(pagesRef.current).issues);
    }, 2500);
    return () => { clearInterval(rotate); clearInterval(grow); };
  }, [phase]);

  useEffect(() => {
    let un1, un2;
    // Results arrive in bursts, each carrying a whole page. Re-rendering on
    // every one starved the WebView's main thread: the bottom bar stopped
    // responding for the length of the crawl. The pages still accumulate on
    // every event — only the render is rationed.
    let pending = false;
    const flush = () => {
      pending = false;
      setCount(pagesRef.current.length);
    };
    listen("crawl_result", (e) => {
      const batch = e?.payload?.results || (e?.payload?.result ? [e.payload.result] : []);
      if (!batch.length) return;
      pagesRef.current.push(...batch);
      if (!pending) {
        pending = true;
        setTimeout(flush, 400);
      }
    }).then((u) => (un1 = u));
    listen("crawl_complete", () => {
      setResult(analyse(pagesRef.current));
      setPhase("done");
    }).then((u) => (un2 = u));
    return () => { un1?.(); un2?.(); };
  }, []);

  /** Runs the crawl itself, once the size question has been settled. */
  const runCrawl = async (domain: string, cap?: number) => {
    // The backend refuses a second crawl while one is registered as running,
    // and the phone app has no Stop button — so pressing بررسی again did
    // nothing at all. Asking the previous crawl to stop makes the button mean
    // "start this one", which is what it looks like it means.
    try {
      await invoke("stop_crawl_command");
      await new Promise((r) => setTimeout(r, 400));
    } catch {
      // Nothing was running; that is the normal case.
    }

    pagesRef.current = [];
    setCount(0);
    setResult(null);
    setDemoSample(false);
    setFailure(null);
    setLiveIssues([]);
    setTip(0);
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
        const base = domain.replace(/\/$/, "");
        const mk = (u, status, title, desc, h1, words, ix = 1) => ({
          url: `${base}${u}`,
          status_code: status, title: [{ title }], description: desc,
          headings: { h1: h1 ? [h1] : [] }, word_count: words,
          indexability: { indexability: ix },
        });

        // Seeded from the domain so the sample answers the thing that was
        // typed. A fixed list returned 96 for every site on earth, which reads
        // as a broken app rather than a demo.
        const seed = [...domain].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
        const pick = (min, max, shift) => min + ((seed >>> shift) % (max - min + 1));

        const posts = pick(40, 160, 0);
        const broken = pick(0, 9, 3);
        const noDesc = pick(0, 8, 6);
        const dupTitle = pick(0, 5, 9);
        const noH1 = pick(0, 4, 12);
        const thin = pick(0, 6, 15);
        const hidden = pick(0, 3, 18);

        const pages = [
          ...Array.from({ length: posts }, (_, i) =>
            mk(`/blog/post-${i}`, 200, `مقاله ${i}`, "توضیح", "عنوان", 700)),
          ...Array.from({ length: broken }, (_, i) => mk(`/old/${i}`, i % 3 === 0 ? 500 : 404, "", "", "", 0)),
          ...Array.from({ length: noDesc }, (_, i) => mk(`/p/${i}`, 200, `صفحه ${i}`, "", "عنوان", 600)),
          ...Array.from({ length: dupTitle }, (_, i) => mk(`/portfolio/${i}`, 200, "نمونه‌کار", "توضیح", "عنوان", 480)),
          ...Array.from({ length: noH1 }, (_, i) => mk(`/lp/${i}`, 200, `لندینگ ${i}`, "توضیح", "", 520)),
          ...Array.from({ length: thin }, (_, i) => mk(`/news/${i}`, 200, `خبر ${i}`, "توضیح", "عنوان", 120)),
          ...Array.from({ length: hidden }, (_, i) => mk(`/private/${i}`, 200, `داخلی ${i}`, "توضیح", "عنوان", 400, 0)),
        ];
        setCount(pages.length);
        setDemoSample(true);
        const res = analyse(pages);
        setResult(res);
        setPhase("done");
        saveToHistory(domain, res, pages.length);
      }, 2600);
      return;
    }

    try {
      await invoke("domain_crawl_command", { domain });
      // crawl_complete usually fires first; this is the fallback.
      if (pagesRef.current.length) {
        const res = analyse(pagesRef.current);
        setResult(res);
        setPhase("done");
        saveToHistory(domain, res, pagesRef.current.length);
      }
    } catch (error) {
      // This used to swallow the error and drop back to idle, so a crawl that
      // could not start looked exactly like a button that does nothing. On a
      // phone there is no console to check, so the reason has to reach the
      // screen or it does not exist.
      if (pagesRef.current.length) {
        const res = analyse(pagesRef.current);
        setResult(res);
        setPhase("done");
        saveToHistory(domain, res, pagesRef.current.length);
      } else {
        setFailure(String(error?.message || error || "خطای ناشناخته"));
        setPhase("idle");
      }
    }
  };

  /** Normalises what was typed into something the backend can parse. */
  const targetUrl = () => {
    const raw = url.trim();
    if (!raw) return "";
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  };

  /** Measures the site, then either crawls it, asks, or declines.
   *
   * A phone pointed at a marketplace spends hours and fills its storage for
   * nothing, and there is no way to tell that from the address alone — so the
   * sitemaps are counted first and the answer decides.
   */
  const start = async () => {
    const domain = targetUrl();
    if (!domain) return;

    setFailure(null);
    setSizing(true);
    let size: any = null;
    try {
      size = await invoke("estimate_site_size_command", { domain });
    } catch {
      // A site that will not answer the question still deserves a crawl; the
      // crawler's own limits apply either way.
    } finally {
      setSizing(false);
    }

    if (size?.verdict === "refuse") {
      setSheet({ kind: "tooBig", data: { domain, size } });
      return;
    }
    if (size?.verdict === "warn") {
      setSheet({ kind: "bigSite", data: { domain, size } });
      return;
    }
    runCrawl(domain);
  };

  const openHistoryEntry = (h) => {
    setResult(h.result);
    setCount(h.pages);
    setUrl(h.domain);
    setPhase("done");
    closeSheet();
    setTab("search");
  };

  const deleteHistoryEntry = (id) => {
    setHistory((prev) => {
      const next = prev.filter((x) => x.id !== id);
      try { localStorage.setItem("onwebs.m.history", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const saveProfile = () => {
    const p = { name: formName.trim(), email: formEmail.trim() };
    setProfile(p);
    try { localStorage.setItem("onwebs.m.profile", JSON.stringify(p)); } catch {}
    closeSheet();
  };

  const g = result ? grade(result.score) : null;
  const R = 52, C = 2 * Math.PI * R;
  const issue = sheet?.kind === "issue" ? sheet.data : null;
  const category = sheet?.kind === "category" ? sheet.data : null;

  return (
    <div dir="rtl" className="min-h-screen w-full flex flex-col items-center px-5 pb-28"
      style={{ background: INK, color: TEXT }}>

      {/* Header: mark, then the search field. Nothing here is decorative. */}
      <style>{`@keyframes onwebs-sweep {
        0%   { transform: translateX(-100%) }
        100% { transform: translateX(300%) }
      }`}</style>

      <header className="w-full max-w-md pt-8 pb-5 flex flex-col items-center">
        {/* The navy mark recoloured to the one accent this screen uses. Its
            own shading is preserved so the form does not flatten into a blob. */}
        <img src="icon-yellow.png" alt="Onwebs" width={54} height={54}
          style={{ filter: "drop-shadow(0 6px 16px rgba(245,197,24,0.22))" }} />
        <h1 className="mt-3 text-[15px] font-extrabold tracking-tight">
          Onwebs <span style={{ color: YELLOW }}>SEO</span>
        </h1>
        <p className="text-[11px] mt-1" style={{ color: MUTED }}>
          آدرس سایتت را بده، وضعیتش را بگویم
        </p>
      </header>

      <div className="w-full max-w-md flex items-center gap-2 rounded-full px-4 py-2.5"
        style={{ background: SURFACE, border: `1px solid ${LINE}` }}>
        <Icon d={PATHS.search} size={18} />
        <input
          dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && start()}
          placeholder="example.com"
          className="flex-1 bg-transparent outline-none text-[13px] text-left"
          style={{ color: TEXT }}
        />
        <button
          onClick={start} disabled={!url.trim() || phase === "crawling" || sizing}
          className="rounded-full px-4 py-1.5 text-[12px] font-extrabold disabled:opacity-30 active:scale-95 transition-transform"
          style={{ background: YELLOW, color: "#0A0A0B" }}
        >
          {sizing ? "…" : phase === "crawling" ? "…" : "بررسی"}
        </button>
      </div>

      {failure && (
        <div className="w-full max-w-md mt-5 rounded-xl px-3 py-2.5 text-[11px] leading-5"
          style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.35)", color: "#FCA5A5" }}>
          <span className="font-bold">کراول شروع نشد.</span>
          <span dir="ltr" className="block mt-1 opacity-80 break-all text-left">{failure}</span>
        </div>
      )}

      {sizing && (
        <section className="w-full max-w-md mt-6">
          <p className="text-[12px] mb-3" style={{ color: MUTED }}>
            در حال اندازه‌گیری سایت…
          </p>
          <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: RAISED }}>
            <div className="h-full w-1/3 rounded-full"
              style={{ background: YELLOW, animation: "onwebs-sweep 1.4s ease-in-out infinite" }} />
          </div>
          <p className="text-[11px] mt-3 leading-6" style={{ color: MUTED }}>
            نقشهٔ سایت را می‌خوانم تا ببینم چند صفحه دارد و کراولش روی گوشی
            شدنی است یا نه.
          </p>
        </section>
      )}

      {phase === "crawling" && (
        <section className="w-full max-w-md mt-6">
          <div className="flex items-center justify-between mb-3">
            {/* Before the first page lands there is real work happening —
                robots.txt, the sitemap, the first requests — and a counter
                sitting on zero reads as a stuck app rather than a busy one. */}
            <span className="text-[12px]" style={{ color: MUTED }}>
              {count === 0 ? (
                "در حال آماده‌سازی کراول…"
              ) : (
                <>
                  <span style={{ color: YELLOW, fontWeight: 800 }}>{count}</span> صفحه بررسی شد
                </>
              )}
            </span>
            {liveIssues.length > 0 && (
              <span className="text-[11px]" style={{ color: MUTED }}>
                {liveIssues.reduce((a, i) => a + i.count, 0)} مورد تا اینجا
              </span>
            )}
          </div>

          {/* A bar with no end point: the total is not known until the crawl
              finishes, so pretending to a percentage would be a lie. */}
          <div className="h-1 w-full rounded-full overflow-hidden mb-5" style={{ background: RAISED }}>
            <div className="h-full w-1/3 rounded-full"
              style={{ background: YELLOW, animation: "onwebs-sweep 1.4s ease-in-out infinite" }} />
          </div>

          <div className="rounded-xl p-4 mb-5" style={{ background: SURFACE, border: `1px solid ${LINE}` }}>
            <div className="flex items-center gap-2 mb-2">
              <Icon d={PATHS.geo} size={16} />
              <span className="text-[11px] font-extrabold" style={{ color: YELLOW }}>
                در این فاصله
              </span>
            </div>
            <p className="text-[12px] leading-6" style={{ color: "#C9C9CF" }}>
              {TIPS[tip]}
            </p>
          </div>

          {liveIssues.length > 0 && (
            <>
              <h2 className="text-[12px] font-extrabold mb-1" style={{ color: MUTED }}>
                تا اینجا پیدا شده
              </h2>
              {liveIssues.map((it) => (
                <Row
                  key={it.key}
                  title={it.title}
                  meta={`${SEV[it.severity].label} · ${it.count} صفحه`}
                  onClick={() => setSheet({ kind: "issue", data: it })}
                  right={
                    <span className="text-[12px] font-extrabold tabular-nums shrink-0"
                      style={{ color: SEV[it.severity].color }}>
                      {it.count}
                    </span>
                  }
                />
              ))}
            </>
          )}
        </section>
      )}

      {/* Without this, invented numbers sit under the domain someone just
          typed and read as a verdict on their site. */}
      {demoSample && phase === "done" && (
        <div className="w-full max-w-md mt-6 rounded-xl px-3 py-2 text-[11px] leading-5"
          style={{ background: "rgba(245,197,24,0.10)", border: `1px solid rgba(245,197,24,0.3)`, color: YELLOW }}>
          نمونه‌ی نمایشی — این اعداد از سایت شما نیست. کراول واقعی فقط در خود
          اپ انجام می‌شود.
        </div>
      )}

      {/* Score. Tapping it explains how it was reached. */}
      {phase === "done" && result && g && (
        <button onClick={() => setSheet({ kind: "score" })}
          className="mt-7 flex flex-col items-center active:opacity-70 transition-opacity">
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r={R} fill="none" stroke={LINE} strokeWidth="9" />
            {/* The arc is correct on first paint and merely transitions to
                it, so a WebView that skips the animation still shows the
                right number rather than an empty ring. */}
            <circle
              cx="70" cy="70" r={R} fill="none" stroke={g.tone} strokeWidth="9"
              strokeLinecap="round" transform="rotate(-90 70 70)"
              strokeDasharray={C}
              strokeDashoffset={C - (result.score / 100) * C}
              style={{ transition: "stroke-dashoffset 900ms ease-out" }}
            />
            <text x="70" y="66" textAnchor="middle" fontSize="34" fontWeight="800" fill={TEXT}>
              {result.score}
            </text>
            <text x="70" y="88" textAnchor="middle" fontSize="12" fill={MUTED}>از ۱۰۰</text>
          </svg>
          <span className="text-[13px] font-extrabold" style={{ color: g.tone }}>{g.label}</span>
          <span className="text-[11px] mt-1" style={{ color: MUTED }}>
            {count} صفحه · {result.issues.reduce((a, i) => a + i.count, 0)} مورد · برای جزئیات بزن
          </span>
        </button>
      )}

      {/* Findings, each one a sheet. */}
      {phase === "done" && result && (
        <section className="w-full max-w-md mt-7">
          <h2 className="text-[12px] font-extrabold mb-1" style={{ color: MUTED }}>
            یافته‌ها
          </h2>
          {result.issues.length === 0 && (
            <p className="text-[12px] py-6 text-center" style={{ color: MUTED }}>
              چیزی برای گزارش نیست.
            </p>
          )}
          {result.issues.map((it) => (
            <Row
              key={it.key}
              title={it.title}
              meta={`${SEV[it.severity].label} · ${it.count} صفحه`}
              onClick={() => setSheet({ kind: "issue", data: it })}
              right={
                <span className="text-[12px] font-extrabold tabular-nums shrink-0"
                  style={{ color: SEV[it.severity].color }}>
                  {it.count}
                </span>
              }
            />
          ))}
        </section>
      )}

      {/* The six areas. Always available — this is what the app checks. */}
      {tab === "search" && phase !== "crawling" && (
        <section className="w-full max-w-md mt-8">
          <h2 className="text-[12px] font-extrabold mb-1" style={{ color: MUTED }}>
            چه چیزهایی بررسی می‌شود
          </h2>
          {CATEGORIES.map((c) => (
            <Row key={c.key} icon={PATHS[c.key]} title={c.title} meta={c.desc}
              onClick={() => setSheet({ kind: "category", data: c })} />
          ))}
        </section>
      )}

      {tab === "history" && (
        <section className="w-full max-w-md mt-6">
          <h2 className="text-[12px] font-extrabold mb-1" style={{ color: MUTED }}>تاریخچه</h2>
          {history.length === 0 && (
            <p className="text-[12px] py-10 text-center" style={{ color: MUTED }}>
              هنوز سایتی بررسی نکرده‌ای.
            </p>
          )}
          {history.map((h) => (
            <Row key={h.id} title={h.domain}
              meta={`${new Date(h.date).toLocaleDateString("fa-IR")} · ${h.pages} صفحه`}
              onClick={() => setSheet({ kind: "historyEntry", data: h })}
              right={
                <span className="text-[12px] font-extrabold tabular-nums shrink-0"
                  style={{ color: grade(h.score).tone }}>{h.score}</span>
              }
            />
          ))}
        </section>
      )}

      {tab === "profile" && (
        <section className="w-full max-w-md mt-6">
          <h2 className="text-[12px] font-extrabold mb-1" style={{ color: MUTED }}>حساب</h2>
          <Row icon={PATHS.profile} title={profile?.name || "تنظیم پروفایل"}
            meta={profile?.email || "نام و ایمیل روی همین دستگاه ذخیره می‌شود"}
            onClick={() => {
              setFormName(profile?.name || "");
              setFormEmail(profile?.email || "");
              setSheet({ kind: "profile" });
            }} />
          <Row icon={PATHS.history} title="پاک کردن تاریخچه"
            meta={`${history.length} مورد ذخیره شده`}
            onClick={() => setSheet({ kind: "clear" })} />
        </section>
      )}

      {/* ── Sheets ─────────────────────────────────────────────────────── */}

      <Sheet open={sheet?.kind === "issue"} onClose={closeSheet}
        title={issue?.title || ""}
        subtitle={issue ? `${SEV[issue.severity].label} · ${issue.count} صفحه` : ""}>
        {issue && (
          <>
            <p className="text-[12px] leading-6 mb-4" style={{ color: "#C9C9CF" }}>{issue.why}</p>
            <h3 className="text-[12px] font-extrabold mb-1" style={{ color: YELLOW }}>راه حل</h3>
            <p className="text-[12px] leading-6 mb-4" style={{ color: "#C9C9CF" }}>{issue.fix}</p>
            {issue.urls.length > 0 && (
              <>
                <h3 className="text-[12px] font-extrabold mb-2" style={{ color: MUTED }}>
                  آدرس‌های درگیر{issue.count > issue.urls.length ? ` (${issue.urls.length} از ${issue.count})` : ""}
                </h3>
                <div className="rounded-xl overflow-hidden" style={{ background: RAISED }}>
                  {issue.urls.map((u) => (
                    <LinkRow key={u} url={u} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Sheet>

      <Sheet open={sheet?.kind === "category"} onClose={closeSheet}
        title={category?.title || ""} subtitle={category?.desc || ""}>
        {category && (
          <>
            <div className="mb-4"><Icon d={PATHS[category.key]} size={30} /></div>
            <p className="text-[12px] leading-6" style={{ color: "#C9C9CF" }}>{category.more}</p>
          </>
        )}
      </Sheet>

      <Sheet open={sheet?.kind === "score"} onClose={closeSheet}
        title="این عدد از کجا آمد؟"
        subtitle={result ? `${count} صفحه بررسی شد` : ""}>
        <p className="text-[12px] leading-6 mb-4" style={{ color: "#C9C9CF" }}>
          از ۱۰۰ شروع می‌شود و هر ایراد به نسبت تعداد صفحه‌های درگیرش کم می‌کند، نه
          به تعداد خودش. برای همین یک سایت ۱۰ صفحه‌ای و یک سایت ۱۰ هزار صفحه‌ای با
          یک معیار سنجیده می‌شوند.
        </p>
        {result?.issues.map((it) => (
          <div key={it.key} className="flex items-center justify-between py-2"
            style={{ borderBottom: `1px solid ${LINE}` }}>
            <span className="text-[12px]" style={{ color: TEXT }}>{it.title}</span>
            <span className="text-[11px] tabular-nums" style={{ color: SEV[it.severity].color }}>
              {it.count} صفحه
            </span>
          </div>
        ))}
      </Sheet>

      <Sheet open={sheet?.kind === "historyEntry"} onClose={closeSheet}
        title={sheet?.data?.domain || ""}
        subtitle={sheet?.data ? `${sheet.data.pages} صفحه · امتیاز ${sheet.data.score}` : ""}>
        <button
          onClick={() => openInBrowser(
            /^https?:\/\//i.test(sheet.data.domain) ? sheet.data.domain : `https://${sheet.data.domain}`,
          )}
          className="w-full rounded-xl py-3 text-[13px] font-bold mb-2"
          style={{ background: RAISED, color: YELLOW }}
        >
          باز کردن سایت در مرورگر
        </button>
        <button onClick={() => openHistoryEntry(sheet.data)}
          className="w-full rounded-xl py-3 text-[13px] font-extrabold mb-2 active:scale-[0.98] transition-transform"
          style={{ background: YELLOW, color: "#0A0A0B" }}>
          باز کردن این گزارش
        </button>
        <button
          onClick={() => { deleteHistoryEntry(sheet.data.id); closeSheet(); }}
          className="w-full rounded-xl py-3 text-[13px] font-bold flex items-center justify-center gap-2"
          style={{ background: RAISED, color: "#F87171" }}>
          <Icon d={PATHS.trash} size={16} color="#F87171" /> حذف
        </button>
      </Sheet>

      {/* Between the warn and refuse thresholds: the crawl is offered, but
          only alongside what it will cost and a smaller way to get an answer. */}
      <Sheet open={sheet?.kind === "bigSite"} onClose={closeSheet}
        title="این سایت بزرگ است"
        subtitle={sheet?.data ? `حدود ${sheet.data.size.urls.toLocaleString("fa-IR")} آدرس در نقشهٔ سایت` : ""}>
        {sheet?.data && (
          <>
            <p className="text-[12px] leading-6 mb-4" style={{ color: "#C9C9CF" }}>
              کراول کامل این تعداد روی گوشی ممکن است ساعت‌ها طول بکشد، باتری و
              حافظه را پر کند و نیمه‌کاره بماند. می‌توانی به‌جایش نمونه‌ای از
              {" "}{sheet.data.size.sampleSize.toLocaleString("fa-IR")} آدرس را
              بررسی کنی — برای قضاوت دربارهٔ وضعیت سایت معمولاً کافی است.
            </p>
            <button
              onClick={() => { closeSheet(); runCrawl(sheet.data.domain, sheet.data.size.sampleSize); }}
              className="w-full rounded-xl py-3 text-[13px] font-extrabold mb-2 active:scale-[0.98] transition-transform"
              style={{ background: YELLOW, color: INK }}>
              بررسی نمونه ({sheet.data.size.sampleSize.toLocaleString("fa-IR")} آدرس)
            </button>
            <button
              onClick={() => { closeSheet(); runCrawl(sheet.data.domain); }}
              className="w-full rounded-xl py-3 text-[13px] font-bold mb-2"
              style={{ background: RAISED, color: TEXT }}>
              با این حال کامل کراول کن
            </button>
            <button onClick={closeSheet}
              className="w-full rounded-xl py-3 text-[13px] font-bold"
              style={{ background: "transparent", color: MUTED }}>
              انصراف
            </button>
          </>
        )}
      </Sheet>

      {/* Past the refuse threshold there is no version of this that ends well
          on a phone, so it is declined rather than offered and abandoned. */}
      <Sheet open={sheet?.kind === "tooBig"} onClose={closeSheet}
        title="این سایت برای گوشی خیلی بزرگ است"
        subtitle={sheet?.data ? `حدود ${sheet.data.size.urls.toLocaleString("fa-IR")} آدرس` : ""}>
        {sheet?.data && (
          <>
            <p className="text-[12px] leading-6 mb-4" style={{ color: "#C9C9CF" }}>
              سقف این اپ {sheet.data.size.refuseAbove.toLocaleString("fa-IR")} آدرس
              است. سایت‌هایی در این ابعاد — فروشگاه‌های بزرگ و مارکت‌پلیس‌ها —
              روی گوشی تمام نمی‌شوند و فقط باتری و حافظه را می‌سوزانند.
            </p>
            <p className="text-[12px] leading-6 mb-4" style={{ color: MUTED }}>
              برای این اندازه از نسخهٔ دسکتاپ استفاده کن؛ همان کراولر است بدون
              این محدودیت.
            </p>
            <button onClick={closeSheet}
              className="w-full rounded-xl py-3 text-[13px] font-extrabold"
              style={{ background: RAISED, color: TEXT }}>
              باشه
            </button>
          </>
        )}
      </Sheet>

      <Sheet open={sheet?.kind === "profile"} onClose={closeSheet}
        title="پروفایل" subtitle="فقط روی همین دستگاه ذخیره می‌شود">
        <input value={formName} onChange={(e) => setFormName(e.target.value)}
          placeholder="نام"
          className="w-full rounded-xl px-3 py-2.5 text-[13px] mb-2 outline-none"
          style={{ background: RAISED, color: TEXT, border: `1px solid ${LINE}` }} />
        <input dir="ltr" value={formEmail} onChange={(e) => setFormEmail(e.target.value)}
          placeholder="email@example.com"
          className="w-full rounded-xl px-3 py-2.5 text-[13px] mb-3 outline-none text-left"
          style={{ background: RAISED, color: TEXT, border: `1px solid ${LINE}` }} />
        <button onClick={saveProfile}
          className="w-full rounded-xl py-3 text-[13px] font-extrabold active:scale-[0.98] transition-transform"
          style={{ background: YELLOW, color: "#0A0A0B" }}>ذخیره</button>
      </Sheet>

      <Sheet open={sheet?.kind === "clear"} onClose={closeSheet}
        title="پاک کردن تاریخچه" subtitle="این کار برگشت‌پذیر نیست">
        <button
          onClick={() => {
            setHistory([]);
            try { localStorage.removeItem("onwebs.m.history"); } catch {}
            closeSheet();
          }}
          className="w-full rounded-xl py-3 text-[13px] font-extrabold"
          style={{ background: "#F87171", color: "#0A0A0B" }}>
          پاک کن
        </button>
      </Sheet>

      {/* Icon-only pill, the shape this app had before: wide targets, no
          labels, and the active one filled rather than tinted. */}
      <nav dir="ltr"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2 rounded-full px-3 py-2"
        style={{
          background: "rgba(20,20,22,0.94)",
          border: `1px solid ${LINE}`,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "0 12px 38px rgba(0,0,0,0.55)",
          marginBottom: "env(safe-area-inset-bottom)",
        }}>
        {[
          { key: "profile", label: "ورود", d: PATHS.profile },
          { key: "search", label: "جستجو", d: PATHS.search },
          { key: "history", label: "تاریخچه", d: PATHS.history },
        ].map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} aria-label={t.label}
              className="flex items-center justify-center rounded-full active:opacity-70 transition-all"
              style={{
                width: 82, height: 54,
                background: active ? YELLOW : "transparent",
                boxShadow: active ? "0 6px 16px rgba(245,197,24,0.28)" : "none",
              }}>
              <Icon d={t.d} size={26} color={active ? INK : MUTED} />
            </button>
          );
        })}
      </nav>
    </div>
  );
}
