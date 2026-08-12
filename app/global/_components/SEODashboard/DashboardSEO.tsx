// @ts-nocheck
"use client";

import React, { useEffect, useState, useMemo } from "react";
import useGlobalCrawlStore from "@/store/GlobalCrawlDataStore";
import IssueDetailDrawer from "./IssueDetailDrawer";
import { canResolve } from "./affectedUrls";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  Globe,
  FileText,
  AlertTriangle,
  CheckCircle,
  Clock,
  Shield,
  Smartphone,
  Code2,
  Image as ImageIcon,
  ArrowLeftRight,
  Activity,
  Layers,
  ArrowRight,
  Database,
  BarChart4,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts";

type DeepCrawlHistory = {
  id?: number;
  domain: string;
  date: string;
  pages: number;
  errors: number;
  status: string;
  total_links: number;
  total_internal_links: number;
  total_external_links: number;
  indexable_pages: number;
  not_indexable_pages: number;
  total_css?: number;
  total_javascript?: number;
  total_images?: number;
  total_redirects?: number;
  missing_title?: number;
  missing_description?: number;
  avg_response_time?: number;
  max_crawl_depth?: number;
  total_secure_pages?: number;
  total_schema_pages?: number;
  total_mobile_pages?: number;
  missing_h1?: number;
  missing_canonical?: number;
  thin_content_pages?: number;
  noindex_pages?: number;
  mixed_content_pages?: number;
  cookies_pages?: number;
  avg_word_count?: number;
  avg_readability?: number;
  avg_page_size_kb?: number;
  duplicate_titles?: number;
  duplicate_descriptions?: number;
  status_2xx?: number;
  status_3xx?: number;
  status_4xx?: number;
  status_5xx?: number;
};

// ---------------------------------------------------------------------------
// Scorecard scoring model
// ---------------------------------------------------------------------------
// Tone tokens (kept as literal Tailwind strings so they survive purge).
const TONE: Record<
  string,
  { text: string; bar: string; soft: string; ring: string }
> = {
  emerald: {
    text: "text-emerald-500",
    bar: "bg-emerald-500",
    soft: "bg-emerald-500/10",
    ring: "#10b981",
  },
  sky: {
    text: "text-sky-500",
    bar: "bg-sky-500",
    soft: "bg-sky-500/10",
    ring: "#0ea5e9",
  },
  amber: {
    text: "text-amber-500",
    bar: "bg-amber-500",
    soft: "bg-amber-500/10",
    ring: "#f59e0b",
  },
  orange: {
    text: "text-orange-500",
    bar: "bg-orange-500",
    soft: "bg-orange-500/10",
    ring: "#f97316",
  },
  rose: {
    text: "text-rose-500",
    bar: "bg-rose-500",
    soft: "bg-rose-500/10",
    ring: "#f43f5e",
  },
  slate: {
    text: "text-slate-500",
    bar: "bg-slate-400",
    soft: "bg-slate-500/10",
    ring: "#94a3b8",
  },
};

const SEV: Record<
  string,
  { text: string; dot: string; soft: string; bar: string; label: string }
> = {
  critical: {
    text: "text-rose-500",
    dot: "bg-rose-500",
    soft: "bg-rose-500/10",
    bar: "bg-rose-500",
    label: "Critical",
  },
  high: {
    text: "text-orange-500",
    dot: "bg-orange-500",
    soft: "bg-orange-500/10",
    bar: "bg-orange-500",
    label: "High",
  },
  medium: {
    text: "text-amber-500",
    dot: "bg-amber-500",
    soft: "bg-amber-500/10",
    bar: "bg-amber-500",
    label: "Medium",
  },
  low: {
    text: "text-sky-500",
    dot: "bg-sky-500",
    soft: "bg-sky-500/10",
    bar: "bg-sky-500",
    label: "Low",
  },
};

// Pick a colour tone for any 0–100 score.
const scoreTone = (v: number) =>
  v >= 80 ? "emerald" : v >= 60 ? "amber" : v >= 40 ? "orange" : "rose";

// Map an overall score to a letter grade.
const gradeInfo = (score: number) => {
  if (score >= 90)
    return { letter: "A", label: "Excellent", tone: "emerald" };
  if (score >= 80) return { letter: "B", label: "Good", tone: "sky" };
  if (score >= 70) return { letter: "C", label: "Fair", tone: "amber" };
  if (score >= 55) return { letter: "D", label: "Needs Work", tone: "orange" };
  return { letter: "F", label: "Critical", tone: "rose" };
};

// Weighted, five-pillar site-health model. Each pillar is 0–100 so an SEO can
// see not just *that* health moved but *where*. Reused for the current and the
// previous crawl to produce real trends.
const computeHealth = (c: DeepCrawlHistory | null) => {
  const empty = {
    overall: 100,
    pillars: {
      indexability: 100,
      http: 100,
      meta: 100,
      content: 100,
      security: 100,
    },
  };
  if (!c) return empty;
  const pages = c.pages || 0;
  if (pages === 0) return empty;

  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const r = (n?: number) => (n || 0) / pages; // share of site affected (0..1)

  // Indexability — share of crawled pages that can actually rank.
  const indexability = clamp(
    Math.round(((c.indexable_pages || 0) / pages) * 100),
  );

  // HTTP health — 5xx is the most damaging, then 4xx, then generic errors.
  const http = clamp(
    100 - r(c.status_5xx) * 400 - r(c.status_4xx) * 220 - r(c.errors) * 140,
  );

  // On-page meta — titles weigh most, then H1s, descriptions and duplicates.
  const meta = clamp(
    100 -
      r(c.missing_title) * 130 -
      r(c.missing_h1) * 60 -
      r(c.missing_description) * 55 -
      r(c.duplicate_titles) * 70 -
      r(c.duplicate_descriptions) * 40 -
      r(c.missing_canonical) * 30,
  );

  // Content quality — blends thin-content rate, depth and readability.
  const wordScore = Math.min(100, ((c.avg_word_count || 0) / 600) * 100);
  const readScore =
    c.avg_readability && c.avg_readability > 0
      ? Math.min(100, c.avg_readability)
      : 70;
  const content = clamp(
    0.5 * (100 - r(c.thin_content_pages) * 130) +
      0.25 * wordScore +
      0.25 * readScore,
  );

  // Security & mobile — HTTPS + mobile coverage, penalised by mixed content.
  const httpsCov = ((c.total_secure_pages || 0) / pages) * 100;
  const mobileCov = ((c.total_mobile_pages || 0) / pages) * 100;
  const security = clamp(
    0.55 * httpsCov + 0.45 * mobileCov - r(c.mixed_content_pages) * 90,
  );

  const overall = Math.round(
    indexability * 0.2 +
      http * 0.25 +
      meta * 0.2 +
      content * 0.15 +
      security * 0.2,
  );

  return {
    overall,
    pillars: { indexability, http, meta, content, security },
  };
};

export default function DashboardSEO() {
  const [history, setHistory] = useState<DeepCrawlHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDomain, setSelectedDomain] = useState<string>("all");
  const [activeSubTab, setActiveSubTab] = useState<
    "overview" | "trends" | "comparison" | "issues"
  >("overview");
  const [confirmDeleteDomain, setConfirmDeleteDomain] = useState(false);
  const [deletingDomain, setDeletingDomain] = useState(false);

  // Comparison State
  const [compCrawl1Id, setCompCrawl1Id] = useState<string>("");
  const [compCrawl2Id, setCompCrawl2Id] = useState<string>("");

  // Issues Reports State
  const [issuesReports, setIssuesReports] = useState<any[]>([]);
  const [issuesReportsLoading, setIssuesReportsLoading] = useState(false);

  // Fetch History from SQLite database
  const fetchHistoryData = async () => {
    setLoading(true);
    try {
      // First ensure the history table exists
      await invoke("create_domain_results_table");
      const result = await invoke("read_domain_results_history_table");
      const parsedHistory = Array.isArray(result) ? result : [];
      setHistory(parsedHistory);

      // Auto-select latest domain if available
      if (parsedHistory.length > 0 && selectedDomain === "all") {
        const uniqueDomains = Array.from(
          new Set(parsedHistory.map((h) => h.domain)),
        );
        if (uniqueDomains.length > 0) {
          setSelectedDomain(uniqueDomains[0]);
        }
      }
    } catch (e) {
      console.error("Failed to load crawl history on dashboard:", e);
      toast.error("بارگذاری تحلیل‌های تاریخی ناموفق بود");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDomainHistory = async () => {
    if (selectedDomain === "all" || selectedDomain === "none") return;

    if (!confirmDeleteDomain) {
      setConfirmDeleteDomain(true);
      return;
    }

    setDeletingDomain(true);
    try {
      await invoke("delete_domain_results_history", { domain: selectedDomain });
      toast.success(`Historical data for ${selectedDomain} deleted`);
      setSelectedDomain("all");
      await fetchHistoryData();
    } catch (e) {
      console.error("Failed to delete domain history:", e);
      toast.error("حذف داده‌های تاریخی ناموفق بود");
    } finally {
      setDeletingDomain(false);
      setConfirmDeleteDomain(false);
    }
  };

  const fetchIssuesReports = async () => {
    setIssuesReportsLoading(true);
    try {
      const result = await invoke("get_issues_reports");
      const parsed = Array.isArray(result) ? result : [];
      setIssuesReports(parsed);
      console.log("=== ISSUES REPORTS ===", JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.error("Failed to fetch issues reports:", e);
    } finally {
      setIssuesReportsLoading(false);
    }
  };

  useEffect(() => {
    fetchHistoryData();
  }, []);

  // Filter history based on selected domain
  const filteredHistory = useMemo(() => {
    if (selectedDomain === "all") return history;
    return history.filter((item) => item.domain === selectedDomain);
  }, [history, selectedDomain]);

  // Unique domains list
  const domainsList = useMemo(() => {
    return Array.from(new Set(history.map((item) => item.domain)));
  }, [history]);

  // Sort history chronologically (oldest first for charts)
  const chronologicalHistory = useMemo(() => {
    return [...filteredHistory].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
  }, [filteredHistory]);

  // Coverage percentages (indexable/HTTPS/schema/mobile as a share of pages
  // crawled) rather than raw counts — raw counts alone are misleading once
  // the number of pages crawled changes between runs.
  const chronologicalHistoryWithRatios = useMemo(() => {
    return chronologicalHistory.map((item) => {
      const pages = item.pages || 0;
      const pct = (n?: number) =>
        pages > 0 ? Math.round(((n || 0) / pages) * 1000) / 10 : 0;
      return {
        ...item,
        indexable_pct: pct(item.indexable_pages),
        https_pct: pct(item.total_secure_pages),
        schema_pct: pct(item.total_schema_pages),
        mobile_pct: pct(item.total_mobile_pages),
      };
    });
  }, [chronologicalHistory]);

  // Latest crawl metrics for selected domain
  const latestCrawl = useMemo(() => {
    if (filteredHistory.length === 0) return null;
    return [...filteredHistory].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    )[0];
  }, [filteredHistory]);

  // Previous crawl metrics to calculate differences
  const previousCrawl = useMemo(() => {
    if (filteredHistory.length < 2) return null;
    return [...filteredHistory].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    )[1];
  }, [filteredHistory]);

  // Setup initial comparison crawls when domain changes
  useEffect(() => {
    if (filteredHistory.length >= 2) {
      const sorted = [...filteredHistory].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
      setCompCrawl1Id(sorted[0].id?.toString() || "");
      setCompCrawl2Id(sorted[1].id?.toString() || "");
    } else {
      setCompCrawl1Id("");
      setCompCrawl2Id("");
    }
  }, [selectedDomain, filteredHistory]);

  // Selected comparison crawls
  const comparisonCrawl1 = useMemo(() => {
    return history.find((c) => c.id?.toString() === compCrawl1Id) || null;
  }, [history, compCrawl1Id]);

  const comparisonCrawl2 = useMemo(() => {
    return history.find((c) => c.id?.toString() === compCrawl2Id) || null;
  }, [history, compCrawl2Id]);

  // Comprehensive five-pillar health for current + previous crawl (real trend).
  const health = useMemo(() => computeHealth(latestCrawl), [latestCrawl]);
  const prevHealth = useMemo(
    () => (previousCrawl ? computeHealth(previousCrawl) : null),
    [previousCrawl],
  );
  const healthScore = health.overall;
  const grade = useMemo(() => gradeInfo(healthScore), [healthScore]);

  // Prioritised action plan — every detected issue, ranked by severity tier
  // then by the number of pages affected, so the biggest wins float to the top.
  // Live crawl rows power the drawer's URL list — the stored per-crawl summary
  // only carries counts, not the addresses behind them.
  const liveCrawlData = useGlobalCrawlStore((st) => st.crawlData);
  const [openIssue, setOpenIssue] = useState<any>(null);

  const prioritizedIssues = useMemo(() => {
    if (!latestCrawl) return [];
    const c = latestCrawl;
    const p = previousCrawl;
    const pages = c.pages || 0;

    const defs = [
      {
        key: "5xx",
        label: "Server Errors (5xx)",
        count: c.status_5xx || 0,
        prev: p?.status_5xx,
        severity: "critical",
        icon: AlertTriangle,
        recommendation:
          "Pages returning server errors can't be crawled or indexed. Fix these first — they signal instability to search engines.",
      },
      {
        key: "4xx",
        label: "Broken Pages (4xx)",
        count: c.status_4xx || 0,
        prev: p?.status_4xx,
        severity: "critical",
        icon: AlertTriangle,
        recommendation:
          "Broken URLs waste crawl budget and lose link equity. Redirect or restore them and fix internal links pointing to them.",
      },
      {
        key: "errors",
        label: "Crawl Errors",
        count: c.errors || 0,
        prev: p?.errors,
        severity: "critical",
        icon: AlertTriangle,
        recommendation:
          "Resolve connection, DNS or timeout errors so search engines can reliably reach your content.",
      },
      {
        key: "missing_title",
        label: "Missing Title Tags",
        count: c.missing_title || 0,
        prev: p?.missing_title,
        severity: "high",
        icon: FileText,
        recommendation:
          "The title is the strongest on-page ranking factor. Write a unique, keyword-led title for every page.",
      },
      {
        key: "dup_title",
        label: "Duplicate Titles",
        count: c.duplicate_titles || 0,
        prev: p?.duplicate_titles,
        severity: "high",
        icon: Code2,
        recommendation:
          "Duplicate titles cause keyword cannibalisation. Differentiate each title so pages target distinct queries.",
      },
      {
        key: "not_indexable",
        label: "Non-Indexable Pages",
        count: c.not_indexable_pages || 0,
        prev: p?.not_indexable_pages,
        severity: "high",
        icon: Globe,
        recommendation:
          "Confirm these exclusions are intentional. Any valuable page that's non-indexable is invisible in search.",
      },
      {
        key: "mixed",
        label: "Mixed Content",
        count: c.mixed_content_pages || 0,
        prev: p?.mixed_content_pages,
        severity: "high",
        icon: Shield,
        recommendation:
          "HTTPS pages loading HTTP assets break the padlock and can be blocked by browsers. Serve every asset over HTTPS.",
      },
      {
        key: "nohttps",
        label: "Pages Without HTTPS",
        count: Math.max(0, pages - (c.total_secure_pages || 0)),
        prev: p
          ? Math.max(0, (p.pages || 0) - (p.total_secure_pages || 0))
          : undefined,
        severity: "high",
        icon: Shield,
        recommendation:
          "HTTPS is a confirmed ranking signal and a trust requirement. Migrate any remaining HTTP pages.",
      },
      {
        key: "missing_h1",
        label: "Missing H1",
        count: c.missing_h1 || 0,
        prev: p?.missing_h1,
        severity: "medium",
        icon: FileText,
        recommendation:
          "Add a single descriptive H1 to clarify each page's primary topic for users and crawlers.",
      },
      {
        key: "missing_desc",
        label: "Missing Meta Descriptions",
        count: c.missing_description || 0,
        prev: p?.missing_description,
        severity: "medium",
        icon: FileText,
        recommendation:
          "Compelling meta descriptions lift click-through rate from the SERP even though they aren't a direct ranking factor.",
      },
      {
        key: "dup_desc",
        label: "Duplicate Descriptions",
        count: c.duplicate_descriptions || 0,
        prev: p?.duplicate_descriptions,
        severity: "medium",
        icon: Code2,
        recommendation:
          "Rewrite duplicated descriptions so each SERP snippet is unique and relevant to that page.",
      },
      {
        key: "thin",
        label: "Thin Content Pages",
        count: c.thin_content_pages || 0,
        prev: p?.thin_content_pages,
        severity: "medium",
        icon: FileText,
        recommendation:
          "Expand or consolidate low-word-count pages — thin content rarely ranks and can drag down site quality signals.",
      },
      {
        key: "canonical",
        label: "Missing Canonical Tags",
        count: c.missing_canonical || 0,
        prev: p?.missing_canonical,
        severity: "medium",
        icon: Code2,
        recommendation:
          "Add self-referencing canonicals to consolidate ranking signals and prevent duplicate-URL dilution.",
      },
      {
        key: "nomobile",
        label: "Non Mobile-Friendly Pages",
        count: Math.max(0, pages - (c.total_mobile_pages || 0)),
        prev: p
          ? Math.max(0, (p.pages || 0) - (p.total_mobile_pages || 0))
          : undefined,
        severity: "medium",
        icon: Smartphone,
        recommendation:
          "Google indexes mobile-first. Ensure every page renders and responds correctly on small screens.",
      },
      {
        key: "redirects",
        label: "Redirect Hops (3xx)",
        count: c.total_redirects || 0,
        prev: p?.total_redirects,
        severity: "low",
        icon: ArrowLeftRight,
        recommendation:
          "Point internal links directly at final URLs to preserve link equity and speed up crawling.",
      },
    ];

    const sevRank: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    return defs
      .filter((d) => d.count > 0)
      .map((d) => ({
        ...d,
        pct: pages > 0 ? (d.count / pages) * 100 : 0,
      }))
      .sort(
        (a, b) => sevRank[a.severity] - sevRank[b.severity] || b.count - a.count,
      );
  }, [latestCrawl, previousCrawl]);

  // Summary of the action plan for the header badges.
  const issuesSummary = useMemo(() => {
    const criticalTypes = prioritizedIssues.filter(
      (i) => i.severity === "critical",
    ).length;
    const affected = prioritizedIssues.reduce((a, b) => a + b.count, 0);
    return { types: prioritizedIssues.length, criticalTypes, affected };
  }, [prioritizedIssues]);

  // HTTP status-code distribution for the response-mix bar.
  const statusDist = useMemo(() => {
    if (!latestCrawl) return [];
    return [
      { name: "2xx OK", value: latestCrawl.status_2xx || 0, color: "#10b981" },
      {
        name: "3xx Redirect",
        value: latestCrawl.status_3xx || 0,
        color: "#f59e0b",
      },
      {
        name: "4xx Broken",
        value: latestCrawl.status_4xx || 0,
        color: "#f43f5e",
      },
      {
        name: "5xx Server",
        value: latestCrawl.status_5xx || 0,
        color: "#7c3aed",
      },
    ].filter((s) => s.value > 0);
  }, [latestCrawl]);

  // Coverage meters — share of crawl passing each key signal.
  const coverage = useMemo(() => {
    if (!latestCrawl) return [];
    const pages = latestCrawl.pages || 1;
    const pc = (n?: number) => Math.round(((n || 0) / pages) * 100);
    return [
      {
        label: "Indexable",
        pct: pc(latestCrawl.indexable_pages),
        icon: Globe,
      },
      {
        label: "HTTPS Secure",
        pct: pc(latestCrawl.total_secure_pages),
        icon: Shield,
      },
      {
        label: "Mobile-Friendly",
        pct: pc(latestCrawl.total_mobile_pages),
        icon: Smartphone,
      },
      {
        label: "Structured Data",
        pct: pc(latestCrawl.total_schema_pages),
        icon: CheckCircle,
      },
    ];
  }, [latestCrawl]);

  // Content-quality mini metrics.
  const contentMetrics = useMemo(() => {
    if (!latestCrawl) return [];
    const c = latestCrawl;
    return [
      {
        label: "Avg Word Count",
        value: (c.avg_word_count || 0).toLocaleString(),
        hint: (c.avg_word_count || 0) < 300 ? "Below depth target" : "Healthy depth",
        good: (c.avg_word_count || 0) >= 300,
        icon: FileText,
      },
      {
        label: "Readability",
        value: `${c.avg_readability || 0}`,
        hint:
          (c.avg_readability || 0) >= 60
            ? "Easy to read"
            : (c.avg_readability || 0) > 0
              ? "Hard to read"
              : "Not scored",
        good: (c.avg_readability || 0) >= 60,
        icon: BarChart4,
      },
      {
        label: "Avg Page Size",
        value: `${(c.avg_page_size_kb || 0).toLocaleString()} KB`,
        hint: (c.avg_page_size_kb || 0) > 2048 ? "Heavy pages" : "Lean pages",
        good: (c.avg_page_size_kb || 0) <= 2048,
        icon: Database,
      },
      {
        label: "Thin Content",
        value: (c.thin_content_pages || 0).toLocaleString(),
        hint: "Low-word pages",
        good: (c.thin_content_pages || 0) === 0,
        icon: AlertTriangle,
      },
    ];
  }, [latestCrawl]);

  // Tech Asset breakdown for Pie Chart
  const techAssetData = useMemo(() => {
    if (!latestCrawl) return [];
    return [
      { name: "Pages", value: latestCrawl.pages || 0, color: "#38bdf8" },
      { name: "CSS", value: latestCrawl.total_css || 0, color: "#a855f7" },
      {
        name: "JS",
        value: latestCrawl.total_javascript || 0,
        color: "#eab308",
      },
      {
        name: "Images",
        value: latestCrawl.total_images || 0,
        color: "#10b981",
      },
      {
        name: "Redirects",
        value: latestCrawl.total_redirects || 0,
        color: "#f97316",
      },
    ].filter((item) => item.value > 0);
  }, [latestCrawl]);

  // Render score growth indicator helper
  const renderGrowth = (
    current: number,
    previous: number | undefined,
    lowerIsBetter = false,
  ) => {
    if (previous === undefined || previous === null || previous === current)
      return null;
    const diff = current - previous;
    const isImproved = lowerIsBetter ? diff < 0 : diff > 0;
    const absDiff = Math.abs(diff);

    return (
      <span
        className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
          isImproved
            ? "bg-emerald-500/10 text-emerald-500"
            : "bg-rose-500/10 text-rose-500"
        }`}
      >
        {isImproved ? (
          <TrendingUp className="w-3 h-3" />
        ) : (
          <TrendingDown className="w-3 h-3" />
        )}
        {absDiff > 0 ? absDiff.toLocaleString() : ""}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full bg-slate-50 dark:bg-brand-darker gap-4">
        <RefreshCw className="w-8 h-8 text-sky-500 animate-spin" />
        <span className="text-slate-500 dark:text-slate-400 font-medium text-xs">
          در حال تحلیل کراول‌های گذشته...
        </span>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-slate-50 dark:bg-brand-darker text-slate-800 dark:text-slate-200 overflow-y-auto px-6 pt-2 pb-20 select-none">
      {/* Top Filter Bar */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-3 border-b border-slate-200 dark:border-slate-800/80 pb-4">
        <div>
          <h1 className="text-base font-bold dark:text-white flex items-center gap-2">
            <BarChart4 className="w-5 h-5 text-sky-500" />
            داشبورد تاریخی SEO
          </h1>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            خط زمانی کراول‌ها، خطاهای فنی، پوشش قابلیت ایندکس و تغییر منابع را مقایسه کنید.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* Domain Selector */}
          <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 shadow-sm">
            <Globe className="w-4 h-4 text-sky-500" />
            <select
              value={selectedDomain}
              onChange={(e) => {
                setSelectedDomain(e.target.value);
                setConfirmDeleteDomain(false);
              }}
              className="bg-transparent border-0 outline-0 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer min-w-[150px]"
            >
              {domainsList.length === 0 && (
                <option value="none">هیچ دامنه‌ای موجود نیست</option>
              )}
              {domainsList.map((dom) => (
                <option key={dom} value={dom}>
                  {dom}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={fetchHistoryData}
            className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 transition-colors text-slate-500 hover:text-sky-500"
            title="بازخوانی داده‌های تاریخچه"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            onClick={handleDeleteDomainHistory}
            onBlur={() => setConfirmDeleteDomain(false)}
            disabled={
              selectedDomain === "all" ||
              selectedDomain === "none" ||
              deletingDomain
            }
            className={`p-2 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              confirmDeleteDomain
                ? "bg-rose-500 border-rose-500 text-white hover:bg-rose-600"
                : "border-slate-200 dark:border-slate-800 text-slate-500 hover:text-rose-500 hover:bg-slate-200 dark:hover:bg-slate-800"
            }`}
            title={
              confirmDeleteDomain
                ? `Click again to permanently delete all history for ${selectedDomain}`
                : `Delete historical data for ${selectedDomain}`
            }
          >
            {confirmDeleteDomain ? (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-1">
                <Trash2 className="w-4 h-4" />
                تأیید
              </span>
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
          </button>
        </div>
      </header>

      {history.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-16 bg-white dark:bg-slate-900/40 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
          <Database className="w-12 h-12 text-slate-400 mb-3" />
          <h3 className="font-semibold text-sm">تاریخچه کراولی موجود نیست</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm text-center">
            اولین کراول عمیق را در تب اصلی اجرا کنید تا نمودارها و خط زمانی SEO پر شوند.
          </p>
        </div>
      ) : (
        <>
          {/* Dashboard Sub-tabs Navigation */}
          <div className="flex items-center gap-2 mb-6 border-b border-slate-200 dark:border-slate-800/60 pb-px">
            {[
              { id: "overview", label: "Crawl Audit Scorecard" },
              { id: "trends", label: "Historical Timeline Trends" },
              { id: "comparison", label: "Crawl-to-Crawl Comparison" },
              // { id: "issues", label: "Issues Reports" }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id as any)}
                className={`text-xs px-4 py-2 border-b-2 font-semibold transition-all relative top-[1px] ${
                  activeSubTab === tab.id
                    ? "border-sky-500 text-sky-500 dark:text-sky-400"
                    : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Sub-tab 1: Crawl Audit Scorecard */}
          {activeSubTab === "overview" && latestCrawl && (
            <div className="flex flex-col gap-5 animate-in fade-in duration-300">
              {/* Row 1: Headline KPI cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Overall Health Grade */}
                <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 rounded-xl p-4 shadow-sm flex items-center gap-4">
                  <div className="relative w-[70px] h-[70px] shrink-0">
                    <svg viewBox="0 0 120 120" className="w-[70px] h-[70px] -rotate-90">
                      <circle
                        cx="60"
                        cy="60"
                        r="52"
                        fill="none"
                        strokeWidth="12"
                        className="stroke-slate-100 dark:stroke-slate-800"
                      />
                      <circle
                        cx="60"
                        cy="60"
                        r="52"
                        fill="none"
                        strokeWidth="12"
                        strokeLinecap="round"
                        stroke={TONE[grade.tone].ring}
                        strokeDasharray={2 * Math.PI * 52}
                        strokeDashoffset={2 * Math.PI * 52 * (1 - healthScore / 100)}
                        style={{ transition: "stroke-dashoffset 0.6s ease" }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className={`text-xl font-extrabold ${TONE[grade.tone].text}`}>
                        {grade.letter}
                      </span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      امتیاز سلامت
                    </span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-extrabold tracking-tight dark:text-white">
                        {healthScore}
                      </span>
                      <span className="text-xs text-slate-400">/100</span>
                      {prevHealth &&
                        renderGrowth(healthScore, prevHealth.overall)}
                    </div>
                    <p className={`text-[10px] font-semibold ${TONE[grade.tone].text}`}>
                      {grade.label}
                    </p>
                  </div>
                </div>

                {/* Pages Crawled */}
                <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 rounded-xl p-4 shadow-sm flex flex-col justify-between">
                  <div className="flex justify-between items-start">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      صفحات کراول‌شده
                    </span>
                    <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-500">
                      <FileText className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="my-2 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold tracking-tight dark:text-white">
                      {(latestCrawl.pages || 0).toLocaleString()}
                    </span>
                    {previousCrawl &&
                      renderGrowth(latestCrawl.pages, previousCrawl.pages)}
                  </div>
                  <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                    <span className="font-semibold text-emerald-500">
                      {Math.round(
                        ((latestCrawl.indexable_pages || 0) /
                          (latestCrawl.pages || 1)) *
                          100,
                      )}
                      %
                    </span>
                    پوشش قابل ایندکس
                  </div>
                </div>

                {/* Broken / Error Pages */}
                {(() => {
                  const broken =
                    (latestCrawl.status_4xx || 0) + (latestCrawl.status_5xx || 0);
                  const prevBroken = previousCrawl
                    ? (previousCrawl.status_4xx || 0) +
                      (previousCrawl.status_5xx || 0)
                    : undefined;
                  const brokenPct = latestCrawl.pages
                    ? (broken / latestCrawl.pages) * 100
                    : 0;
                  return (
                    <div
                      onClick={() =>
                        broken > 0 &&
                        setOpenIssue(
                          prioritizedIssues.find((i) => i.key === "4xx") ||
                            prioritizedIssues.find((i) => i.key === "5xx") ||
                            null,
                        )
                      }
                      role={broken > 0 ? "button" : undefined}
                      title={broken > 0 ? "نمایش صفحات خراب" : undefined}
                      className={`bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 rounded-xl p-4 shadow-sm flex flex-col justify-between ${
                        broken > 0
                          ? "cursor-pointer hover:border-rose-400 transition-colors"
                          : ""
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          صفحات خراب
                        </span>
                        <div
                          className={`p-1.5 rounded-lg ${broken > 0 ? "bg-rose-500/10 text-rose-500" : "bg-emerald-500/10 text-emerald-500"}`}
                        >
                          <AlertTriangle className="w-4 h-4" />
                        </div>
                      </div>
                      <div className="my-2 flex items-baseline gap-2">
                        <span
                          className={`text-3xl font-extrabold tracking-tight ${broken > 0 ? "text-rose-500" : "dark:text-white"}`}
                        >
                          {broken.toLocaleString()}
                        </span>
                        {previousCrawl &&
                          renderGrowth(broken, prevBroken, true)}
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                        <span className="font-semibold text-rose-500">
                          {brokenPct.toFixed(1)}%
                        </span>
                        از کراول (4xx + 5xx)
                      </div>
                    </div>
                  );
                })()}

                {/* Avg Response Time */}
                <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 rounded-xl p-4 shadow-sm flex flex-col justify-between">
                  <div className="flex justify-between items-start">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      میانگین زمان پاسخ
                    </span>
                    <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-500">
                      <Clock className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="my-2 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold tracking-tight dark:text-white">
                      {latestCrawl.avg_response_time ?? 0}
                      <span className="text-sm font-normal text-slate-400 ml-0.5">
                        ms
                      </span>
                    </span>
                    {previousCrawl &&
                      renderGrowth(
                        latestCrawl.avg_response_time || 0,
                        previousCrawl.avg_response_time || 0,
                        true,
                      )}
                  </div>
                  <div className="text-[10px] text-slate-400 flex items-center gap-1">
                    حداکثر عمق کراول
                    <span className="font-bold text-sky-500">
                      {latestCrawl.max_crawl_depth ?? 0}
                    </span>
                  </div>
                </div>
              </div>

              {/* Row 2: Prioritized Action Plan + Health Pillars */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Prioritized Action Plan */}
                <div className="lg:col-span-8 bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                        برنامه اقدام اولویت‌بندی‌شده
                      </h3>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                        بر اساس شدت و تعداد صفحات درگیر مرتب شده — از بالا شروع کنید.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {issuesSummary.criticalTypes > 0 && (
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-rose-500/10 text-rose-500">
                          {issuesSummary.criticalTypes} critical
                        </span>
                      )}
                      <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300">
                        {issuesSummary.types} issue{issuesSummary.types === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>

                  {prioritizedIssues.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="p-3 rounded-full bg-emerald-500/10 text-emerald-500 mb-3">
                        <CheckCircle className="w-7 h-7" />
                      </div>
                      <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">
                        هیچ مشکلی شناسایی نشد
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
                        این کراول همه بررسی‌های فنی، درون‌صفحه و امنیتی را با موفقیت گذراند. برای شناسایی افت‌های بعدی، به‌طور منظم اسکن کنید.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[430px] overflow-y-auto pr-1 -mr-1">
                      {prioritizedIssues.map((issue, idx) => {
                        const sev = SEV[issue.severity];
                        const Icon = issue.icon;
                        const delta =
                          issue.prev !== undefined && issue.prev !== null
                            ? issue.count - issue.prev
                            : null;
                        return (
                          <div
                            key={issue.key}
                            onClick={() =>
                              canResolve(issue.key) && setOpenIssue(issue)
                            }
                            role={canResolve(issue.key) ? "button" : undefined}
                            title={
                              canResolve(issue.key)
                                ? "برای دیدن توضیح کامل و فهرست آدرس‌ها کلیک کنید"
                                : undefined
                            }
                            className={`group flex items-start gap-3 p-3 rounded-lg border border-slate-100 dark:border-slate-800/70 hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${
                              canResolve(issue.key) ? "cursor-pointer" : ""
                            }`}
                          >
                            <div className="flex flex-col items-center pt-0.5">
                              <span className="text-[10px] font-bold text-slate-300 dark:text-slate-600 w-4 text-center">
                                {idx + 1}
                              </span>
                            </div>
                            <div className={`p-1.5 rounded-lg shrink-0 ${sev.soft} ${sev.text}`}>
                              <Icon className="w-3.5 h-3.5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                                    {issue.label}
                                  </span>
                                  <span
                                    className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${sev.soft} ${sev.text} shrink-0`}
                                  >
                                    {sev.label}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {delta !== null && delta !== 0 && (
                                    <span
                                      className={`inline-flex items-center gap-0.5 text-[9px] font-semibold ${delta < 0 ? "text-emerald-500" : "text-rose-500"}`}
                                    >
                                      {delta < 0 ? (
                                        <TrendingDown className="w-2.5 h-2.5" />
                                      ) : (
                                        <TrendingUp className="w-2.5 h-2.5" />
                                      )}
                                      {Math.abs(delta).toLocaleString()}
                                    </span>
                                  )}
                                  <span className="text-sm font-extrabold text-slate-800 dark:text-white">
                                    {issue.count.toLocaleString()}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 mt-1.5">
                                <div className="flex-1 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${sev.bar}`}
                                    style={{
                                      width: `${Math.max(2, Math.min(100, issue.pct))}%`,
                                    }}
                                  />
                                </div>
                                <span className="text-[9px] font-semibold text-slate-400 w-14 text-right">
                                  {issue.pct.toFixed(1)}% of site
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                                {issue.recommendation}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Health Pillars */}
                <div className="lg:col-span-4 bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm flex flex-col">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400 mb-1">
                    تفکیک سلامت
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-5">
                    پنج ستون وزن‌دار پشت امتیاز کلی.
                  </p>

                  <div className="space-y-4 flex-1">
                    {[
                      {
                        label: "Indexability",
                        value: health.pillars.indexability,
                        prev: prevHealth?.pillars.indexability,
                        icon: Globe,
                      },
                      {
                        label: "HTTP Health",
                        value: health.pillars.http,
                        prev: prevHealth?.pillars.http,
                        icon: Activity,
                      },
                      {
                        label: "On-Page Meta",
                        value: health.pillars.meta,
                        prev: prevHealth?.pillars.meta,
                        icon: Code2,
                      },
                      {
                        label: "Content Quality",
                        value: health.pillars.content,
                        prev: prevHealth?.pillars.content,
                        icon: FileText,
                      },
                      {
                        label: "Security & Mobile",
                        value: health.pillars.security,
                        prev: prevHealth?.pillars.security,
                        icon: Shield,
                      },
                    ].map((pillar) => {
                      const tone = TONE[scoreTone(pillar.value)];
                      const Icon = pillar.icon;
                      const delta =
                        pillar.prev !== undefined
                          ? pillar.value - pillar.prev
                          : null;
                      return (
                        <div key={pillar.label}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                              <Icon className={`w-3 h-3 ${tone.text}`} />
                              {pillar.label}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {delta !== null && delta !== 0 && (
                                <span
                                  className={`text-[9px] font-semibold ${delta > 0 ? "text-emerald-500" : "text-rose-500"}`}
                                >
                                  {delta > 0 ? "+" : ""}
                                  {delta}
                                </span>
                              )}
                              <span className={`text-xs font-bold ${tone.text}`}>
                                {pillar.value}
                              </span>
                            </div>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${tone.bar}`}
                              style={{ width: `${pillar.value}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Row 3: Coverage & response mix + Tech assets */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Coverage meters + HTTP status distribution */}
                <div className="lg:col-span-8 bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400 mb-4">
                    پوشش و ترکیب پاسخ‌ها
                  </h3>

                  {/* Coverage meters */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                    {coverage.map((m) => {
                      const tone = TONE[scoreTone(m.pct)];
                      const Icon = m.icon;
                      return (
                        <div
                          key={m.label}
                          className="flex flex-col items-center text-center"
                        >
                          <div className="relative w-[62px] h-[62px]">
                            <svg
                              viewBox="0 0 120 120"
                              className="w-[62px] h-[62px] -rotate-90"
                            >
                              <circle
                                cx="60"
                                cy="60"
                                r="52"
                                fill="none"
                                strokeWidth="12"
                                className="stroke-slate-100 dark:stroke-slate-800"
                              />
                              <circle
                                cx="60"
                                cy="60"
                                r="52"
                                fill="none"
                                strokeWidth="12"
                                strokeLinecap="round"
                                stroke={tone.ring}
                                strokeDasharray={2 * Math.PI * 52}
                                strokeDashoffset={
                                  2 * Math.PI * 52 * (1 - m.pct / 100)
                                }
                                style={{ transition: "stroke-dashoffset 0.6s ease" }}
                              />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className={`text-xs font-extrabold ${tone.text}`}>
                                {m.pct}%
                              </span>
                            </div>
                          </div>
                          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mt-2 flex items-center gap-1">
                            <Icon className="w-3 h-3" />
                            {m.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* HTTP status distribution bar */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        توزیع HTTP Status
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {statusDist
                          .reduce((a, b) => a + b.value, 0)
                          .toLocaleString()}{" "}
                        responses
                      </span>
                    </div>
                    {statusDist.length > 0 ? (
                      <>
                        <div className="flex w-full h-3 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                          {statusDist.map((s) => {
                            const total = statusDist.reduce(
                              (a, b) => a + b.value,
                              0,
                            );
                            const w = total > 0 ? (s.value / total) * 100 : 0;
                            return (
                              <div
                                key={s.name}
                                style={{
                                  width: `${w}%`,
                                  backgroundColor: s.color,
                                }}
                                title={`${s.name}: ${s.value}`}
                              />
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
                          {statusDist.map((s) => (
                            <div
                              key={s.name}
                              className="flex items-center gap-1.5 text-[10px]"
                            >
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: s.color }}
                              />
                              <span className="text-slate-500 dark:text-slate-400">
                                {s.name}
                              </span>
                              <span className="font-bold text-slate-700 dark:text-slate-200">
                                {s.value.toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-slate-400 py-4">
                        هیچ داده status code‌ای برای این کراول ثبت نشده است.
                      </p>
                    )}
                  </div>
                </div>

                {/* Tech assets composition */}
                <div className="lg:col-span-4 bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm flex flex-col">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400 mb-2">
                    منابع فنی
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-4">
                    صفحات و فایل‌های جانبی کشف‌شده در کراول.
                  </p>

                  {techAssetData.length > 0 ? (
                    <div className="flex-1 flex flex-col justify-center items-center">
                      <div className="h-[140px] w-full relative">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={techAssetData}
                              cx="50%"
                              cy="50%"
                              innerRadius={42}
                              outerRadius={62}
                              paddingAngle={4}
                              dataKey="value"
                            >
                              {techAssetData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                background: "#0f172a",
                                border: "none",
                                borderRadius: "8px",
                                fontSize: "11px",
                                color: "#fff",
                              }}
                              itemStyle={{ color: "#fff" }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                            منابع
                          </span>
                          <span className="text-lg font-extrabold tracking-tight dark:text-white">
                            {techAssetData.reduce((a, b) => a + b.value, 0)}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 w-full mt-4">
                        {techAssetData.map((item, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-[11px] border-b border-slate-100 dark:border-slate-800 pb-1"
                          >
                            <div className="flex items-center gap-1.5">
                              <div
                                className="w-[7px] h-[7px] rounded-full"
                                style={{ backgroundColor: item.color }}
                              />
                              <span className="font-medium text-slate-600 dark:text-slate-400">
                                {item.name}
                              </span>
                            </div>
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {item.value.toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center py-10">
                      <span className="text-xs text-slate-400">
                        هیچ ترکیبی از منابع پیدا نشد.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Row 4: Content quality metrics */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400 mb-4">
                  سیگنال‌های کیفیت محتوا
                </h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {contentMetrics.map((m) => {
                    const Icon = m.icon;
                    return (
                      <div
                        key={m.label}
                        className="rounded-lg border border-slate-100 dark:border-slate-800/70 p-3.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            {m.label}
                          </span>
                          <div
                            className={`p-1 rounded ${m.good ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                        </div>
                        <div className="text-xl font-extrabold tracking-tight dark:text-white mt-1.5">
                          {m.value}
                        </div>
                        <p
                          className={`text-[10px] font-medium mt-0.5 ${m.good ? "text-emerald-500" : "text-amber-500"}`}
                        >
                          {m.hint}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {/* Automated insight */}
                <div className="mt-5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 rounded-lg flex items-start gap-3">
                  <div
                    className={`p-1 rounded mt-0.5 ${prioritizedIssues.length === 0 ? "bg-emerald-500/10 text-emerald-500" : TONE[grade.tone].soft + " " + TONE[grade.tone].text}`}
                  >
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                      بینش خودکار ممیزی
                    </h5>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      {prioritizedIssues.length === 0
                        ? "Excellent — this crawl passed every check. Keep scanning regularly to catch regressions in indexability, meta tags or redirect loops early."
                        : `Grade ${grade.letter} (${healthScore}/100). Your biggest win right now is "${prioritizedIssues[0].label}", affecting ${prioritizedIssues[0].count.toLocaleString()} page${prioritizedIssues[0].count === 1 ? "" : "s"} (${prioritizedIssues[0].pct.toFixed(1)}% of the crawl). ${prioritizedIssues[0].recommendation}`}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sub-tab 2: Timeline Trends */}
          {activeSubTab === "trends" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">
              {/* Chart 1: Crawl Growth Over Time */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    روند صفحات و قابلیت ایندکس
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    پایش صفحات قابل ایندکس کراول‌شده در مقایسه با کل فایل‌ها در طول زمان.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="colorPages"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#38bdf8"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#38bdf8"
                            stopOpacity={0.0}
                          />
                        </linearGradient>
                        <linearGradient
                          id="colorIndexable"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#10b981"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#10b981"
                            stopOpacity={0.0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Area
                        type="natural"
                        dataKey="pages"
                        name="Total Pages"
                        stroke="#38bdf8"
                        fillOpacity={1}
                        fill="url(#colorPages)"
                        strokeWidth={2}
                      />
                      <Area
                        type="natural"
                        dataKey="indexable_pages"
                        name="Indexable Pages"
                        stroke="#10b981"
                        fillOpacity={1}
                        fill="url(#colorIndexable)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 2: SEO Audits / Anomalies */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    مشکلات تگ‌های کیفیت SEO
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    پایش صفحات بدون Title یا meta description در طول زمان.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="missing_title"
                        name="Missing Title"
                        stroke="#f97316"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="missing_description"
                        name="Missing Description"
                        stroke="#eab308"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 3: Response Speeds Timeline */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    سرعت عملکرد سایت
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    میانگین تاریخی زمان بارگذاری در parser کراولر عمیق.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="colorSpeed"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#ec4899"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#ec4899"
                            stopOpacity={0.0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        unit="ms"
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Area
                        type="natural"
                        dataKey="avg_response_time"
                        name="Avg Response Time (ms)"
                        stroke="#ec4899"
                        fillOpacity={1}
                        fill="url(#colorSpeed)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 4: Technical Error logs */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    لینک‌های خراب و Redirectها
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    پایش زمانی شکست‌های ایندکس صفحات (خطاها و redirectها).
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Bar
                        dataKey="errors"
                        name="Errors"
                        fill="#ef4444"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="total_redirects"
                        name="Redirects"
                        fill="#f97316"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 4b: HTTP Status Code Breakdown */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    تفکیک HTTP Status Code
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    توزیع پاسخ‌ها در هر کراول — افزایش سهم 4xx/5xx نشانه لینک‌های خراب یا مشکلات سرور است.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Bar
                        dataKey="status_2xx"
                        name="2xx Success"
                        stackId="status"
                        fill="#22c55e"
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="status_3xx"
                        name="3xx Redirect"
                        stackId="status"
                        fill="#f97316"
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="status_4xx"
                        name="4xx Client Error"
                        stackId="status"
                        fill="#ef4444"
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="status_5xx"
                        name="5xx Server Error"
                        stackId="status"
                        fill="#991b1b"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 5: Internal vs External Links */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    لینک‌های داخلی در برابر خارجی
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    ترکیب پروفایل لینک در طول زمان — کاهش سهم لینک داخلی می‌تواند نشانه تضعیف معماری سایت باشد.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="total_internal_links"
                        name="Internal Links"
                        stroke="#6366f1"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="total_external_links"
                        name="External Links"
                        stroke="#a78bfa"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 6: Technical Assets Growth */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    رشد منابع فنی
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    منابع CSS، JavaScript و تصویری کشف‌شده در هر کراول.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="total_css"
                        name="CSS Files"
                        stroke="#a855f7"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="total_javascript"
                        name="JavaScript Files"
                        stroke="#eab308"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="total_images"
                        name="Images"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 7: Compliance Coverage Trend */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    روند پوشش انطباق
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    پوشش HTTPS، داده ساختاریافته و سازگاری با موبایل به‌صورت سهمی از صفحات کراول‌شده — نرمال‌سازی شده تا تغییر اندازه کراول روند را مخدوش نکند.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chronologicalHistoryWithRatios}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        unit="%"
                        domain={[0, 100]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="https_pct"
                        name="HTTPS Coverage"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="schema_pct"
                        name="Structured Data Coverage"
                        stroke="#6366f1"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="mobile_pct"
                        name="Mobile-Friendly Coverage"
                        stroke="#38bdf8"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 8: Indexability Ratio Trend */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    روند نسبت قابلیت ایندکس
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    سهم صفحات کراول‌شده که قابل ایندکس هستند، در طول زمان.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chronologicalHistoryWithRatios}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="colorIndexablePct"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#10b981"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#10b981"
                            stopOpacity={0.0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        unit="%"
                        domain={[0, 100]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Area
                        type="natural"
                        dataKey="indexable_pct"
                        name="Indexable Pages (%)"
                        stroke="#10b981"
                        fillOpacity={1}
                        fill="url(#colorIndexablePct)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 9: Crawl Depth Trend */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    روند عمق کراول
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    حداکثر عمق کلیک از URL شروع در هر کراول — افزایش عمق می‌تواند نشانه گسترده‌تر شدن ساختار سایت باشد.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Bar
                        dataKey="max_crawl_depth"
                        name="Max Crawl Depth"
                        fill="#14b8a6"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 10: Duplicate Content Trend */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    روند محتوای تکراری
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    تکرارهای اضافی Title یا Description فراتر از اولین مورد یکتا — همان مشکلی که کشویی‌های Titleهای صفحه و Meta Description در تب عمومی برای هر کراول نشان می‌دهند.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="duplicate_titles"
                        name="Duplicate Titles"
                        stroke="#f97316"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="duplicate_descriptions"
                        name="Duplicate Descriptions"
                        stroke="#eab308"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 11: Content Structure Issues */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    مشکلات ساختار محتوا
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    صفحاتی که H1 یا تگ canonical ندارند — همان بررسی‌های کشویی‌های H1 و Canonicals در تب عمومی.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="missing_h1"
                        name="Missing H1"
                        stroke="#ef4444"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="missing_canonical"
                        name="Missing Canonical"
                        stroke="#6366f1"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 12: Thin Content & Noindex Trend */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    روند محتوای کم و Noindex
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    صفحات زیر ۳۰۰ کلمه و صفحاتی که با دستور noindex از ایندکس شدن منع شده‌اند — همان ایده کشویی‌های تعداد کلمات و Meta Robots در تب عمومی.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="thin_content_pages"
                        name="Thin Content (<300 words)"
                        stroke="#f97316"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="noindex_pages"
                        name="Noindex Pages"
                        stroke="#ef4444"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 13: Average Word Count Trend */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    روند میانگین تعداد کلمات
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    میانگین طول محتوا در هر کراول — همان معیار کشویی تعداد کلمات در تب عمومی، در طول زمان.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="colorAvgWordCount"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#38bdf8"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#38bdf8"
                            stopOpacity={0.0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Area
                        type="natural"
                        dataKey="avg_word_count"
                        name="Avg Word Count"
                        stroke="#38bdf8"
                        fillOpacity={1}
                        fill="url(#colorAvgWordCount)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 14: Average Readability Trend */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    روند میانگین خوانایی
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    میانگین امتیاز Flesch Reading Ease در هر کراول (۰ تا ۱۰۰؛ بالاتر یعنی خواندن آسان‌تر) — همان معیار کشویی خوانایی در تب عمومی.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="colorAvgReadability"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#10b981"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#10b981"
                            stopOpacity={0.0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Area
                        type="natural"
                        dataKey="avg_readability"
                        name="Avg Reading Ease"
                        stroke="#10b981"
                        fillOpacity={1}
                        fill="url(#colorAvgReadability)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 15: Average Page Size Trend */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    روند میانگین حجم صفحه
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    میانگین حجم انتقال HTML در هر کراول — همان معیار کشویی وزن صفحه در تب عمومی.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient
                          id="colorAvgPageSize"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#ec4899"
                            stopOpacity={0.4}
                          />
                          <stop
                            offset="95%"
                            stopColor="#ec4899"
                            stopOpacity={0.0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        unit="KB"
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Area
                        type="natural"
                        dataKey="avg_page_size_kb"
                        name="Avg Page Size (KB)"
                        stroke="#ec4899"
                        fillOpacity={1}
                        fill="url(#colorAvgPageSize)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 16: Security & Privacy Trend */}
              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm">
                <div className="mb-4">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    روند امنیت و حریم خصوصی
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    صفحاتی با محتوای ترکیبی و صفحاتی که cookie ست می‌کنند — همان بررسی‌های کشویی‌های امنیت و Cookieها در تب عمومی.
                  </p>
                </div>
                <div className="h-[250px] w-full mt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chronologicalHistory}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(255,255,255,0.05)"
                      />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(v) => v.split("T")[0]}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        style={{ fontSize: "9px" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#0f172a",
                          border: "none",
                          borderRadius: "8px",
                          fontSize: "11px",
                          color: "#fff",
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={11.9}
                        wrapperStyle={{ fontSize: "9.82px" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="mixed_content_pages"
                        name="Mixed Content Pages"
                        stroke="#ef4444"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="cookies_pages"
                        name="Pages Setting Cookies"
                        stroke="#a78bfa"
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Sub-tab 4: Issues Reports */}
          {activeSubTab === "issues" && (
            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm animate-in fade-in duration-300">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    گزارش‌های ذخیره‌شده مشکلات
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    گزارش‌های مشکلات تولیدشده پس از پایان هر کراول را ببینید.
                  </p>
                </div>
                <button
                  onClick={fetchIssuesReports}
                  disabled={issuesReportsLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
                >
                  <Database className="w-4 h-4" />
                  {issuesReportsLoading
                    ? "Loading..."
                    : "Fetch & Console.log Reports"}
                </button>
              </div>

              {issuesReports.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                        <th className="py-2.5 px-4 font-bold text-slate-500 dark:text-slate-400 text-[10px] uppercase">
                          ID
                        </th>
                        <th className="py-2.5 px-4 font-bold text-slate-500 dark:text-slate-400 text-[10px] uppercase">
                          دامنه
                        </th>
                        <th className="py-2.5 px-4 font-bold text-slate-500 dark:text-slate-400 text-[10px] uppercase">
                          تاریخ
                        </th>
                        <th className="py-2.5 px-4 font-bold text-slate-500 dark:text-slate-400 text-[10px] uppercase">
                          URLهای کراول‌شده
                        </th>
                        <th className="py-2.5 px-4 font-bold text-slate-500 dark:text-slate-400 text-[10px] uppercase">
                          مشکلات پیداشده
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {issuesReports.map((report, idx) => (
                        <tr
                          key={report.id || idx}
                          className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20 transition-colors"
                        >
                          <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400">
                            {report.id}
                          </td>
                          <td className="py-2.5 px-4 font-semibold text-slate-700 dark:text-slate-300">
                            {report.domain}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">
                            {report.crawl_date?.split("T")[0] ||
                              report.crawl_date}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-400">
                            {report.total_urls_crawled}
                          </td>
                          <td className="py-2.5 px-4 font-mono font-bold text-amber-500">
                            {report.total_issues_found}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-10 text-center">
                  <p className="text-xs text-slate-400">
                    {issuesReportsLoading
                      ? "Loading reports..."
                      : "No issues reports found. Run a crawl to generate one."}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Sub-tab 3: Crawl-to-Crawl Comparison */}
          {activeSubTab === "comparison" && (
            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 shadow-sm animate-in fade-in duration-300">
              <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
                    مقایسه کنار‌به‌کنار کراول‌ها
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    دو تاریخ کراول را انتخاب کنید تا بهبودها یا افت‌ها را ببینید.
                  </p>
                </div>

                {/* selectors */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      کراول A:
                    </span>
                    <select
                      value={compCrawl1Id}
                      onChange={(e) => setCompCrawl1Id(e.target.value)}
                      className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 outline-none text-xs font-semibold px-2 py-1 rounded cursor-pointer text-slate-700 dark:text-slate-300"
                    >
                      {filteredHistory.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.date.split("T")[0]} ({c.pages} pgs)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">
                      کراول B:
                    </span>
                    <select
                      value={compCrawl2Id}
                      onChange={(e) => setCompCrawl2Id(e.target.value)}
                      className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 outline-none text-xs font-semibold px-2 py-1 rounded cursor-pointer text-slate-700 dark:text-slate-300"
                    >
                      {filteredHistory.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.date.split("T")[0]} ({c.pages} pgs)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Comparison Sheet */}
              {comparisonCrawl1 && comparisonCrawl2 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                        <th className="py-2.5 px-4 font-bold text-slate-500 dark:text-slate-400 text-[10px] uppercase">
                          دسته معیار SEO
                        </th>
                        <th className="py-2.5 px-4 font-bold text-slate-700 dark:text-slate-300">
                          Crawl A ({comparisonCrawl1.date.split("T")[0]})
                        </th>
                        <th className="py-2.5 px-4 font-bold text-slate-700 dark:text-slate-300">
                          Crawl B ({comparisonCrawl2.date.split("T")[0]})
                        </th>
                        <th className="py-2.5 px-4 font-bold text-slate-700 dark:text-slate-300">
                          اختلاف مطلق / وضعیت
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                      {[
                        {
                          label: "Pages Crawled",
                          key: "pages",
                          lowerIsBetter: false,
                        },
                        {
                          label: "Page Auditing Errors",
                          key: "errors",
                          lowerIsBetter: true,
                        },
                        {
                          label: "Total Backlinks/Links",
                          key: "total_links",
                          lowerIsBetter: false,
                        },
                        {
                          label: "Internal Hyperlinks",
                          key: "total_internal_links",
                          lowerIsBetter: false,
                        },
                        {
                          label: "External Hyperlinks",
                          key: "total_external_links",
                          lowerIsBetter: false,
                        },
                        {
                          label: "Indexable URL Count",
                          key: "indexable_pages",
                          lowerIsBetter: false,
                        },
                        {
                          label: "Not-Indexable Pages",
                          key: "not_indexable_pages",
                          lowerIsBetter: true,
                        },
                        {
                          label: "CSS Files",
                          key: "total_css",
                          lowerIsBetter: false,
                        },
                        {
                          label: "JavaScript Files",
                          key: "total_javascript",
                          lowerIsBetter: false,
                        },
                        {
                          label: "Images Scanned",
                          key: "total_images",
                          lowerIsBetter: false,
                        },
                        {
                          label: "3xx Redirect URLs",
                          key: "total_redirects",
                          lowerIsBetter: true,
                        },
                        {
                          label: "Avg Response Speed (ms)",
                          key: "avg_response_time",
                          lowerIsBetter: true,
                        },
                        {
                          label: "Max Crawl Depth Reach",
                          key: "max_crawl_depth",
                          lowerIsBetter: false,
                        },
                        {
                          label: "Missing Meta Titles",
                          key: "missing_title",
                          lowerIsBetter: true,
                        },
                        {
                          label: "Missing Meta Descriptions",
                          key: "missing_description",
                          lowerIsBetter: true,
                        },
                        {
                          label: "Schema / Structured Data Pages",
                          key: "total_schema_pages",
                          lowerIsBetter: false,
                        },
                        {
                          label: "Secure Pages (HTTPS)",
                          key: "total_secure_pages",
                          lowerIsBetter: false,
                        },
                        {
                          label: "Mobile-Friendly Pages",
                          key: "total_mobile_pages",
                          lowerIsBetter: false,
                        },
                        {
                          label: "Missing H1 Tags",
                          key: "missing_h1",
                          lowerIsBetter: true,
                        },
                        {
                          label: "Missing Canonical Tags",
                          key: "missing_canonical",
                          lowerIsBetter: true,
                        },
                        {
                          label: "Thin Content Pages",
                          key: "thin_content_pages",
                          lowerIsBetter: true,
                        },
                        {
                          label: "Noindex Pages",
                          key: "noindex_pages",
                          lowerIsBetter: true,
                        },
                        {
                          label: "Mixed Content Pages",
                          key: "mixed_content_pages",
                          lowerIsBetter: true,
                        },
                        {
                          label: "Cookie-Flagged Pages",
                          key: "cookies_pages",
                          lowerIsBetter: true,
                        },
                        {
                          label: "Avg Word Count",
                          key: "avg_word_count",
                          lowerIsBetter: false,
                        },
                        {
                          label: "Avg Readability Score",
                          key: "avg_readability",
                          lowerIsBetter: false,
                        },
                        {
                          label: "Avg Page Size (KB)",
                          key: "avg_page_size_kb",
                          lowerIsBetter: true,
                        },
                        {
                          label: "Duplicate Titles",
                          key: "duplicate_titles",
                          lowerIsBetter: true,
                        },
                        {
                          label: "Duplicate Descriptions",
                          key: "duplicate_descriptions",
                          lowerIsBetter: true,
                        },
                      ].map((row, idx) => {
                        const val1 = (comparisonCrawl1[
                          row.key as keyof DeepCrawlHistory
                        ] ?? 0) as number;
                        const val2 = (comparisonCrawl2[
                          row.key as keyof DeepCrawlHistory
                        ] ?? 0) as number;
                        const diff = val2 - val1;
                        const isImproved = row.lowerIsBetter
                          ? diff < 0
                          : diff > 0;
                        const hasNoChange = diff === 0;

                        return (
                          <tr
                            key={idx}
                            className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20 transition-colors"
                          >
                            <td className="py-2.5 px-4 font-semibold text-slate-700 dark:text-slate-300">
                              {row.label}
                            </td>
                            <td className="py-2.5 px-4 font-medium font-mono text-slate-600 dark:text-slate-400">
                              {val1.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-4 font-medium font-mono text-slate-600 dark:text-slate-400">
                              {val2.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-4">
                              {hasNoChange ? (
                                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                                  بدون تغییر
                                </span>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`font-mono font-bold ${isImproved ? "text-emerald-500" : "text-rose-500"}`}
                                  >
                                    {diff > 0
                                      ? `+${diff.toLocaleString()}`
                                      : diff.toLocaleString()}
                                  </span>
                                  <span
                                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                                      isImproved
                                        ? "bg-emerald-500/10 text-emerald-500"
                                        : "bg-rose-500/10 text-rose-500"
                                    }`}
                                  >
                                    {isImproved ? "Improved" : "Regressed"}
                                  </span>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-10 text-center">
                  <span className="text-xs text-slate-400">
                    برای تحلیل مقایسه‌ای حداقل ۲ رکورد کراول لازم است.
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Full explanation + the URLs behind whichever action-plan item was clicked */}
      <IssueDetailDrawer
        issue={openIssue}
        crawlData={liveCrawlData}
        severity={openIssue ? SEV[openIssue.severity] : null}
        onClose={() => setOpenIssue(null)}
      />
    </div>
  );
}
