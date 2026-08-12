// @ts-nocheck
// Gathers every piece of data the Server Log Report needs into one typed
// object, fetched fresh at report-generation time rather than trusting
// whatever happens to already be cached in the store — mirrors the same
// "authoritative fetch, not stale UI state" approach used by the crawl
// report (see ../CrawlReport/generateCrawlReportPDF.ts).
import { invoke } from "@tauri-apps/api/core";
import { useLogAnalysisStore } from "@/store/ServerLogsStore";
import { useServerLogsStore } from "@/store/ServerLogsGlobalStore";

export interface NameValue {
  name: string;
  value: number;
}

export interface ServerLogReportData {
  overview: any;
  trendTotals: any;
  widgetAggs: any;
  timelineData: any[];
  statusTimelineData: any[];
  crawlerTimelineData: any[];
  fileTypeTimelineData: any[];
  bandwidthTimelineData: any[];
  indexingCrawlers: NameValue[];
  retrievalAgents: NameValue[];
  agenticBots: NameValue[];
  contentSegments: NameValue[];
  uploadedLogFiles: any[];
}

// Same "Area: what changed" style filter used by WidgetLogs.tsx's Indexing /
// Retrieval / Agentic tabs: case-insensitive match of widgetAggs.crawler_types
// keys against a config-driven bot-name list, sorted by hit count.
const filterCrawlerTypes = (
  crawlerTypes: Record<string, number> | undefined,
  botNames: string[],
): NameValue[] => {
  if (!crawlerTypes || !botNames?.length) return [];
  const botSet = new Set(botNames.map((n) => n.toLowerCase()));
  const displayNameMap = new Map(botNames.map((n) => [n.toLowerCase(), n]));
  return Object.entries(crawlerTypes)
    .filter(([name]) => botSet.has(name.toLowerCase()))
    .map(([name, value]) => ({
      name: displayNameMap.get(name.toLowerCase()) || name,
      value: value as number,
    }))
    .sort((a, b) => b.value - a.value);
};

// Content-segment names are user-defined taxonomies stored client-side only
// (no backend command for this) — same lookup WidgetLogs.tsx uses for its
// "Content" tab.
const buildTaxonomyNameMap = (): Record<string, string> => {
  const map: Record<string, string> = {};
  try {
    const stored = localStorage.getItem("taxonomies");
    if (!stored) return map;
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return map;
    for (const tax of parsed) {
      for (const p of tax?.paths || []) {
        const pathString = typeof p === "string" ? p : p?.path;
        if (pathString) map[pathString] = tax.name;
      }
    }
  } catch {
    // Malformed/missing localStorage value — report just falls back to raw keys.
  }
  return map;
};

const toNameValueList = (
  record: Record<string, number> | undefined,
  nameMap?: Record<string, string>,
): NameValue[] => {
  if (!record) return [];
  return Object.entries(record)
    .map(([key, value]) => ({ name: nameMap?.[key] || key, value: value as number }))
    .sort((a, b) => b.value - a.value);
};

export { toNameValueList };

// Returns null when there's no log data loaded at all, so the caller can
// short-circuit with a friendly message instead of generating an empty report.
export async function fetchServerLogReportData(): Promise<ServerLogReportData | null> {
  const store = useLogAnalysisStore.getState();
  if (!store.overview?.line_count) return null;

  const filters = store.activeFilters;
  const viewMode = "daily";

  const [
    overviewRes,
    trendTotalsRes,
    widgetAggsRes,
    indexingBotsRes,
    retrievalAgentsRes,
    agenticBotsRes,
    timelineRes,
    statusRes,
    crawlerRes,
    filetypeRes,
    bandwidthRes,
  ] = await Promise.allSettled([
    invoke("get_active_logs_stats", { filters }),
    invoke("get_trend_totals_summary"),
    invoke("get_widget_aggregations", { filters }),
    invoke("get_indexing_bots_command"),
    invoke("get_retrieval_agents_command"),
    invoke("get_agentic_bots_command"),
    invoke("get_timeline_aggregations", { viewMode, filters }),
    invoke("get_status_aggregations", { viewMode, filters }),
    invoke("get_crawler_aggregations", { viewMode, filters }),
    invoke("get_filetype_aggregations", { viewMode, filters }),
    invoke("get_bandwidth_aggregations", { viewMode, filters }),
  ]);

  const value = <T,>(res: PromiseSettledResult<T>, fallback: T): T =>
    res.status === "fulfilled" && res.value != null ? res.value : fallback;

  const overview = value(overviewRes, store.overview);
  const widgetAggs = value(widgetAggsRes, store.widgetAggs || {});
  const indexingBots = value(indexingBotsRes, [] as string[]);
  const retrievalAgentsNames = value(retrievalAgentsRes, [] as string[]);
  const agenticBotsNames = value(agenticBotsRes, [] as string[]);

  const taxonomyNameMap = buildTaxonomyNameMap();

  return {
    overview,
    trendTotals: value(trendTotalsRes, store.trendTotals),
    widgetAggs,
    timelineData: value(timelineRes, store.timelineData || []),
    statusTimelineData: value(statusRes, store.statusTimelineData || []),
    crawlerTimelineData: value(crawlerRes, store.crawlerTimelineData || []),
    fileTypeTimelineData: value(filetypeRes, store.fileTypeTimelineData || []),
    bandwidthTimelineData: value(bandwidthRes, store.bandwidthTimelineData || []),
    indexingCrawlers: filterCrawlerTypes(widgetAggs.crawler_types, indexingBots),
    retrievalAgents: filterCrawlerTypes(widgetAggs.crawler_types, retrievalAgentsNames),
    agenticBots: filterCrawlerTypes(widgetAggs.crawler_types, agenticBotsNames),
    contentSegments: toNameValueList(widgetAggs.content, taxonomyNameMap),
    uploadedLogFiles: useServerLogsStore.getState().uploadedLogFiles || [],
  };
}
