// @ts-nocheck
import { useEffect, useState, useCallback, memo, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import useCrawlStore, { useFinalCrawlStats } from "@/store/GlobalCrawlDataStore";
import { Badge } from "@mantine/core";
import { debounce } from "lodash";

const FooterLoader = () => {
  const streamedCrawledPages = useCrawlStore(
    (state) => state.streamedCrawledPages,
  );
  const streamedTotalPages = useCrawlStore((state) => state.streamedTotalPages);
  const setStreamedCrawledPages = useCrawlStore(
    (state) => state.setStreamedCrawledPages,
  );
  const setStreamedTotalPages = useCrawlStore(
    (state) => state.setStreamedTotalPages,
  );
  const setTotalUrlsCrawled = useCrawlStore((state) => state.setTotalUrlsCrawled);
  const domainCrawlLoading = useCrawlStore((state) => state.domainCrawlLoading);
  const isFinishedDeepCrawl = useCrawlStore((state) => state.isFinishedDeepCrawl);
  const setFinishedDeepCrawl = useCrawlStore(
    (state) => state.setFinishedDeepCrawl,
  );

  const crawlDataLength = useCrawlStore((state) => state.crawlData.length);
  // Authoritative post-crawl count from SQLite — shared with Summary/Overview
  // so "pages crawled" can't disagree between widgets.
  const finalCrawlStats = useFinalCrawlStats();

  const [failedPages, setFailedPages] = useState(0);

  // What the crawler is doing right now. Without this a crawl stuck on a
  // timing-out host is indistinguishable from a broken one: the percentage
  // just sits there with nothing to explain it.
  const [activity, setActivity] = useState<{
    kind: string;
    url: string;
    detail: string;
  } | null>(null);
  // Internal state to track if we've shown the "Complete" message for the current session
  const [showComplete, setShowComplete] = useState(false);
  // Server-driven backoff info: shown while the adaptive rate limiter is active.
  // `until` is a wall-clock deadline after which the notice auto-hides.
  const [rateLimit, setRateLimit] = useState<{
    until: number;
    delayMs: number;
    status: number;
  } | null>(null);

  // Debounced update function to ensure smooth UI and sync with store
  const debouncedUpdate = useCallback(
    debounce((crawled_urls, total_urls, failed_urls) => {
      setStreamedCrawledPages(crawled_urls);
      setStreamedTotalPages(total_urls);
      setTotalUrlsCrawled(total_urls);
      setFailedPages(failed_urls);
    }, 300),
    [setStreamedCrawledPages, setStreamedTotalPages, setTotalUrlsCrawled],
  );

  useEffect(() => {
    // Progress listener — this is the ONE canonical listener for progress_update
    const progressUnlistenPromise = listen("progress_update", (event: any) => {
      const { crawled_urls, percentage, total_urls, failed_urls_count } =
        event.payload;

      // Backend emits crawled_urls = succeeded + failed. Subtract failed to get
      // the true successful count that matches the table row count.
      const succeededUrls = Math.max(
        0,
        (crawled_urls || 0) - (failed_urls_count || 0),
      );
      const safeCrawledUrls = succeededUrls;
      const safeTotalUrls = Math.max(1, total_urls || 1);
      const safeFailedUrls = Math.max(0, failed_urls_count || 0);

      debouncedUpdate(safeCrawledUrls, safeTotalUrls, safeFailedUrls);
    });

    // Completion listener
    const completeUnlistenPromise = listen("crawl_complete", (event: any) => {
      // Use getState() to avoid stale closure over crawlData
      const currentData = useCrawlStore.getState().crawlData;
      const failedCount = event.payload?.failed_urls_count || 0;
      const totalCrawled =
        event.payload?.crawled_urls || currentData?.length || 0;
      // Subtract failed so displayed count matches the table (which only shows successful results)
      const finalCount = Math.max(0, totalCrawled - failedCount);
      setStreamedCrawledPages(finalCount);
      setStreamedTotalPages(
        event.payload?.total_urls || finalCount + failedCount,
      );
      setFailedPages(failedCount);
      setShowComplete(true);
      setFinishedDeepCrawl(true);
    });

    const activityUnlistenPromise = listen("crawl_activity", (event: any) => {
      const p = event.payload || {};
      setActivity({
        kind: p.kind || "",
        url: p.url || "",
        detail: p.detail || "",
      });
    });

    // Rate-limit listener — backend emits this whenever the adaptive crawler
    // backs off after a 429/503 or a detected block. Keep the notice visible
    // for the cooldown period (min 10s) since the delay decays gradually.
    const rateLimitUnlistenPromise = listen(
      "crawl_rate_limited",
      (event: any) => {
        const { delay_ms, cooldown_ms, status } = event.payload || {};
        setRateLimit({
          until: Date.now() + Math.max(cooldown_ms || 0, 10000),
          delayMs: delay_ms || 0,
          status: status || 0,
        });
      },
    );

    return () => {
      progressUnlistenPromise.then((unlisten) => unlisten());
      activityUnlistenPromise.then((unlisten) => unlisten());
      completeUnlistenPromise.then((unlisten) => unlisten());
      rateLimitUnlistenPromise.then((unlisten) => unlisten());
    };
    // Register once — use getState() for fresh data instead of adding crawlData to deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedUpdate,
    setStreamedCrawledPages,
    setStreamedTotalPages,
    setFinishedDeepCrawl,
  ]);

  // Sync showComplete with store state
  useEffect(() => {
    if (domainCrawlLoading) {
      setShowComplete(false);
      setRateLimit(null);
      setActivity(null);
    } else if (isFinishedDeepCrawl && crawlDataLength > 0) {
      setShowComplete(true);
      setRateLimit(null);
    }
  }, [domainCrawlLoading, isFinishedDeepCrawl, crawlDataLength]);

  // Auto-hide the rate-limit notice once its deadline passes
  useEffect(() => {
    if (!rateLimit) return;
    const remaining = rateLimit.until - Date.now();
    if (remaining <= 0) {
      setRateLimit(null);
      return;
    }
    const timer = setTimeout(() => setRateLimit(null), remaining);
    return () => clearTimeout(timer);
  }, [rateLimit]);

  // Derived state for rendering
  const displayCrawled = useMemo(() => {
    if (showComplete && typeof finalCrawlStats?.pages === "number") {
      return finalCrawlStats.pages;
    }
    return showComplete
      ? streamedCrawledPages || crawlDataLength || 0
      : streamedCrawledPages || 0;
  }, [showComplete, crawlDataLength, streamedCrawledPages, finalCrawlStats]);

  const displayTotal = useMemo(() => {
    return showComplete
      ? streamedTotalPages || crawlDataLength || 0
      : streamedTotalPages || 0;
  }, [showComplete, crawlDataLength, streamedTotalPages]);

  // Percentage calculation
  const percentage = useMemo(() => {
    if (displayTotal === 0) return 0;
    const pct = (displayCrawled / displayTotal) * 100;
    return Math.min(100, Math.max(0, pct));
  }, [displayCrawled, displayTotal]);

  return (
    <div className="flex items-center space-x-4 h-full ml-4">
      {/* Progress Section */}
      <div className="flex items-center space-x-3 bg-gray-200/50 dark:bg-black/20 px-3 py-1 rounded-full border border-gray-300/50 dark:border-white/10 backdrop-blur-sm">
        {/* Progress Bar Container */}
        <div className="relative w-36 h-2 bg-gray-300/50 dark:bg-white/5 rounded-full overflow-hidden shadow-inner">
          <div
            className={`absolute top-0 left-0 h-full bg-gradient-to-r from-brand-bright via-sky-400 to-brand-bright rounded-full transition-all duration-500 ease-out ${!showComplete ? "animate-pulse" : ""}`}
            style={{
              width: `${percentage}%`,
              boxShadow: "0 0 8px rgba(56, 189, 248, 0.4)",
            }}
          />
        </div>

        {/* Percentage */}
        <span className="text-[11px] font-bold text-brand-bright min-w-[32px] font-mono">
          {percentage.toFixed(0)}%
        </span>
      </div>

      <div className="h-4 w-[1px] bg-gray-400 dark:bg-white/10" />

      {/* Stats Section */}
      <div className="flex items-center space-x-4 text-[11px] tracking-tight">
        <div className="flex items-center space-x-1.5">
          <span className="text-black dark:text-white/40 uppercase font-bold text-[9px]">
            کراول‌شده:
          </span>
          <span className="text-gray-700 dark:text-white font-mono font-medium">
            {displayCrawled}
          </span>
        </div>

        <div className="flex items-center space-x-1.5">
          <span className="text-black dark:text-white/40 uppercase font-bold text-[9px]">
            در صف:
          </span>
          <span className="text-gray-700 dark:text-white font-mono font-medium">
            {showComplete ? 0 : Math.max(0, displayTotal - displayCrawled)}
          </span>
        </div>

        {failedPages > 0 && (
          <div className="flex items-center space-x-1.5">
            <span className="text-red-500/60 dark:text-red-400/60 uppercase font-bold text-[9px]">
              ناموفق:
            </span>
            <span className="text-red-600 dark:text-red-400 font-mono font-medium">
              {failedPages}
            </span>
          </div>
        )}

        {rateLimit && !showComplete && (
          <div
            className="flex items-center space-x-1.5 animate-in fade-in duration-300"
            title={`${rateLimit.status ? `سرور با HTTP ${rateLimit.status} پاسخ داد` : "بلاک ضدربات شناسایی شد"} — کراولر در حال کاهش سرعت است (تأخیر فعلی ${(rateLimit.delayMs / 1000).toFixed(1)} ثانیه به ازای هر درخواست)`}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
            <span className="text-amber-600/80 dark:text-amber-400/70 uppercase font-bold text-[9px]">
              محدودیت نرخ — سرعت کم شد
            </span>
          </div>
        )}

        {activity && !showComplete && (
          <div
            className="flex items-center gap-1.5 min-w-0 max-w-[360px]"
            title={`${activity.url}\n${activity.detail}`}
          >
            <span
              className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                activity.kind === "error" ? "bg-red-500" : "bg-emerald-500"
              }`}
            />
            <span
              className="truncate text-[10px] font-mono text-gray-600 dark:text-white/50"
              style={{ direction: "ltr", textAlign: "left" }}
            >
              {activity.url.replace(/^https?:\/\//, "")}
            </span>
            <span
              className={`shrink-0 text-[10px] font-mono ${
                activity.kind === "error"
                  ? "text-red-500"
                  : "text-gray-500 dark:text-white/40"
              }`}
            >
              {activity.detail.length > 34
                ? `${activity.detail.slice(0, 34)}…`
                : activity.detail}
            </span>
          </div>
        )}

        {(showComplete ||
          (percentage >= 99.9 &&
            !domainCrawlLoading &&
            crawlDataLength > 0)) && (
          <Badge
            variant="filled"
            size="xs"
            className="animate-in fade-in zoom-in duration-300 h-4.5 py-0 px-1.5 text-[9px] bg-brand-bright"
          >
            کراول تمام شد
          </Badge>
        )}
      </div>
    </div>
  );
};

// Memoize the component to prevent re-renders if props/state haven't changed
export default memo(FooterLoader);
