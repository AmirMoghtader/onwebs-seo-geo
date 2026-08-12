// @ts-nocheck
// One function per report section — each takes the current y position and
// the assembled report data, draws its section, and returns the new y so
// the main generator (generateServerLogReportPDF.ts) can chain them in
// order without knowing anything about each section's internals.
import type { jsPDF } from "jspdf";
import {
  sectionTitle,
  subNote,
  ensureSpace,
  kvTable,
  dataTable,
  pct0,
  truncate,
  formatBytes,
  DANGER_COLOR,
} from "../pdfReportUtils";
import { drawStackedBarChart, drawPieChart, CHART_PALETTE } from "./charts";
import type { ServerLogReportData, NameValue } from "./fetchServerLogReportData";
import { toNameValueList } from "./fetchServerLogReportData";

const fmtDate = (iso: string | undefined): string => {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
};

const nameValueTable = (
  doc: jsPDF,
  y: number,
  head: [string, string],
  rows: NameValue[],
  cap = 25,
): number => {
  if (!rows.length) {
    return subNote(doc, "No data available.", y);
  }
  const capped = rows.slice(0, cap);
  const total = rows.reduce((s, r) => s + r.value, 0);
  let newY = dataTable(
    doc,
    y,
    [[head[0], head[1], "%"]],
    capped.map((r) => [truncate(r.name, 60), String(r.value), pct0(r.value, total)]),
    { fontSize: 7.5 },
  );
  if (rows.length > cap) {
    newY = subNote(doc, `…and ${rows.length - cap} more.`, newY);
  }
  return newY;
};

// ---------------------------------------------------------------------------
// 1. Executive Summary
// ---------------------------------------------------------------------------
export const renderExecutiveSummary = (doc: jsPDF, y: number, data: ServerLogReportData): number => {
  const o = data.overview || {};
  y = sectionTitle(doc, "Executive Summary", y);
  y = kvTable(doc, y, [
    ["Total Requests", String(o.line_count ?? 0)],
    ["Unique IPs", String(o.unique_ips ?? 0)],
    ["Unique User Agents", String(o.unique_user_agents ?? 0)],
    ["Crawler Requests", `${o.crawler_count ?? 0} (${pct0(o.crawler_count ?? 0, o.line_count ?? 0)})`],
    ["Success Rate", `${o.success_rate != null ? Number(o.success_rate).toFixed(1) : "0"}%`],
    ["Log Files Processed", String(o.file_count ?? 0)],
    ["Log Period Start", fmtDate(o.log_start_time)],
    ["Log Period End", fmtDate(o.log_finish_time)],
  ]);
  return y;
};

// ---------------------------------------------------------------------------
// 2. Traffic Overview — human vs crawler timeline
// ---------------------------------------------------------------------------
export const renderTrafficOverview = (doc: jsPDF, y: number, data: ServerLogReportData): number => {
  const pageWidth = doc.internal.pageSize.getWidth();
  y = ensureSpace(doc, y, 90);
  y = sectionTitle(doc, "Traffic Overview — Human vs. Crawler", y);
  y = subNote(doc, "Daily request volume, split between human visitors and detected crawlers/bots.", y);
  y = drawStackedBarChart(
    doc,
    14,
    y,
    pageWidth - 28,
    data.timelineData,
    [
      { key: "human", label: "Human", color: [16, 185, 129] },
      { key: "crawler", label: "Crawler", color: [139, 92, 246] },
    ],
    "date",
  );
  return y + 4;
};

// ---------------------------------------------------------------------------
// 3. HTTP Status Codes
// ---------------------------------------------------------------------------
export const renderStatusCodes = (doc: jsPDF, y: number, data: ServerLogReportData): number => {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.addPage();
  y = 20;
  y = sectionTitle(doc, "HTTP Status Codes", y);
  y = drawStackedBarChart(
    doc,
    14,
    y,
    pageWidth - 28,
    data.statusTimelineData,
    [
      { key: "success", label: "2xx Success", color: [16, 185, 129] },
      { key: "redirect", label: "3xx Redirect", color: [245, 158, 11] },
      { key: "clientError", label: "4xx Client Error", color: [249, 115, 22] },
      { key: "serverError", label: "5xx Server Error", color: [239, 68, 68] },
    ],
    "date",
  );

  y = ensureSpace(doc, y, 70);
  y = sectionTitle(doc, "Status Code Breakdown", y);
  const statusRows = toNameValueList(data.widgetAggs?.status_codes);
  if (statusRows.length) {
    const centerX = 45;
    const centerY = y + 25;
    y = drawPieChart(doc, centerX, centerY, 22, statusRows) + 6;
    y = ensureSpace(doc, y, 40);
    y = nameValueTable(doc, y, ["Status Code", "Requests"], statusRows);
  } else {
    y = subNote(doc, "No status code data available.", y);
  }
  return y;
};

// ---------------------------------------------------------------------------
// 4. File Types
// ---------------------------------------------------------------------------
export const renderFileTypes = (doc: jsPDF, y: number, data: ServerLogReportData): number => {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.addPage();
  y = 20;
  y = sectionTitle(doc, "File Types", y);
  y = drawStackedBarChart(
    doc,
    14,
    y,
    pageWidth - 28,
    data.fileTypeTimelineData,
    [
      { key: "html", label: "HTML", color: [37, 99, 235] },
      { key: "css", label: "CSS", color: [139, 92, 246] },
      { key: "js", label: "JS", color: [245, 158, 11] },
      { key: "image", label: "Image", color: [16, 185, 129] },
      { key: "other", label: "Other", color: [100, 116, 139] },
    ],
    "date",
  );

  y = ensureSpace(doc, y, 70);
  y = sectionTitle(doc, "File Type Breakdown", y);
  const fileTypeRows = toNameValueList(data.widgetAggs?.file_types);
  if (fileTypeRows.length) {
    const centerY = y + 25;
    y = drawPieChart(doc, 45, centerY, 22, fileTypeRows) + 6;
    y = ensureSpace(doc, y, 40);
    y = nameValueTable(doc, y, ["File Type", "Requests"], fileTypeRows);
  } else {
    y = subNote(doc, "No file type data available.", y);
  }
  return y;
};

// ---------------------------------------------------------------------------
// 5. Bandwidth
// ---------------------------------------------------------------------------
export const renderBandwidth = (doc: jsPDF, y: number, data: ServerLogReportData): number => {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.addPage();
  y = 20;
  y = sectionTitle(doc, "Bandwidth", y);
  const totalBytes = (data.bandwidthTimelineData || []).reduce(
    (sum, d) => sum + (Number(d.bytes) || 0),
    0,
  );
  y = kvTable(doc, y, [["Total Bandwidth Served", formatBytes(totalBytes)]]);
  y = drawStackedBarChart(
    doc,
    14,
    y,
    pageWidth - 28,
    data.bandwidthTimelineData,
    [{ key: "bytes", label: "Bytes Served", color: [37, 99, 235] }],
    "date",
  );
  return y + 4;
};

// ---------------------------------------------------------------------------
// 6. Crawler Traffic — the 8 named bot totals + timeline
// ---------------------------------------------------------------------------
export const renderCrawlerTraffic = (doc: jsPDF, y: number, data: ServerLogReportData): number => {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.addPage();
  y = 20;
  y = sectionTitle(doc, "Crawler Traffic", y);
  y = drawStackedBarChart(
    doc,
    14,
    y,
    pageWidth - 28,
    data.crawlerTimelineData,
    [
      { key: "google", label: "Google", color: [37, 99, 235] },
      { key: "bing", label: "Bing", color: [245, 158, 11] },
      { key: "openai", label: "OpenAI", color: [16, 185, 129] },
      { key: "claude", label: "Claude", color: [236, 72, 153] },
      { key: "other", label: "Other", color: [100, 116, 139] },
    ],
    "date",
  );

  y = ensureSpace(doc, y, 60);
  y = sectionTitle(doc, "Aggregated Crawler Totals", y);
  const totals = data.overview?.totals || {};
  const botRows: NameValue[] = [
    { name: "Google", value: totals.google || 0 },
    { name: "Bing", value: totals.bing || 0 },
    { name: "Semrush", value: totals.semrush || 0 },
    { name: "Ahrefs", value: totals.hrefs || 0 },
    { name: "Moz", value: totals.moz || 0 },
    { name: "Uptime", value: totals.uptime || 0 },
    { name: "OpenAI", value: totals.openai || 0 },
    { name: "Claude", value: totals.claude || 0 },
  ].filter((r) => r.value > 0);
  y = nameValueTable(doc, y, ["Crawler", "Requests"], botRows, 20);
  return y;
};

// Shared layout for the three config-driven bot-category sections
// (Indexing / Retrieval / Agentic) — identical shape, different data.
const renderBotCategorySection = (
  doc: jsPDF,
  y: number,
  title: string,
  description: string,
  rows: NameValue[],
): number => {
  doc.addPage();
  y = 20;
  y = sectionTitle(doc, title, y);
  y = subNote(doc, description, y);
  if (!rows.length) {
    y = subNote(doc, "No matching bot activity found in this log data.", y);
    return y;
  }
  const centerY = y + 25;
  y = drawPieChart(doc, 45, centerY, 22, rows) + 6;
  y = ensureSpace(doc, y, 40);
  y = nameValueTable(doc, y, ["Bot", "Requests"], rows, 25);
  return y;
};

// ---------------------------------------------------------------------------
// 7-9. Indexing Crawlers / Retrieval Agents / Agentic Bots
// ---------------------------------------------------------------------------
export const renderIndexingCrawlers = (doc: jsPDF, y: number, data: ServerLogReportData): number =>
  renderBotCategorySection(
    doc,
    y,
    "Indexing Crawlers",
    "Traditional search-engine crawlers (Google, Bing, Yandex, Baidu, and other classic indexing bots).",
    data.indexingCrawlers,
  );

export const renderRetrievalAgents = (doc: jsPDF, y: number, data: ServerLogReportData): number =>
  renderBotCategorySection(
    doc,
    y,
    "AI Retrieval Agents",
    "AI assistants and answer engines fetching content on a user's behalf (ChatGPT, Claude, Perplexity, Gemini, and similar).",
    data.retrievalAgents,
  );

export const renderAgenticBots = (doc: jsPDF, y: number, data: ServerLogReportData): number =>
  renderBotCategorySection(
    doc,
    y,
    "Agentic Bots",
    "Autonomous agents performing multi-step tasks/research (deep-research and agentic browsing bots).",
    data.agenticBots,
  );

// ---------------------------------------------------------------------------
// 10-12. User Agents / Referrers / Content Segments
// ---------------------------------------------------------------------------
export const renderUserAgents = (doc: jsPDF, y: number, data: ServerLogReportData): number => {
  doc.addPage();
  y = 20;
  y = sectionTitle(doc, "User Agents", y);
  const rows = toNameValueList(data.widgetAggs?.user_agent_categories || data.widgetAggs?.user_agents);
  if (!rows.length) return subNote(doc, "No user agent data available.", y);
  const centerY = y + 25;
  y = drawPieChart(doc, 45, centerY, 22, rows) + 6;
  y = ensureSpace(doc, y, 40);
  return nameValueTable(doc, y, ["User Agent", "Requests"], rows);
};

export const renderReferrers = (doc: jsPDF, y: number, data: ServerLogReportData): number => {
  doc.addPage();
  y = 20;
  y = sectionTitle(doc, "Referrers", y);
  const rows = toNameValueList(data.widgetAggs?.referrer_categories || data.widgetAggs?.referrers);
  if (!rows.length) return subNote(doc, "No referrer data available.", y);
  const centerY = y + 25;
  y = drawPieChart(doc, 45, centerY, 22, rows) + 6;
  y = ensureSpace(doc, y, 40);
  return nameValueTable(doc, y, ["Referrer", "Requests"], rows);
};

export const renderContentSegments = (doc: jsPDF, y: number, data: ServerLogReportData): number => {
  doc.addPage();
  y = 20;
  y = sectionTitle(doc, "Content Segments", y);
  y = subNote(doc, "Traffic grouped by your configured taxonomy/segment rules.", y);
  if (!data.contentSegments.length) {
    return subNote(doc, "No content segments configured, or no matching traffic.", y);
  }
  const centerY = y + 25;
  y = drawPieChart(doc, 45, centerY, 22, data.contentSegments) + 6;
  y = ensureSpace(doc, y, 40);
  return nameValueTable(doc, y, ["Segment", "Requests"], data.contentSegments);
};

// ---------------------------------------------------------------------------
// 13. Crawl Sync / SEO Health — derived from crawl-file + GSC matching
// ---------------------------------------------------------------------------
export const renderCrawlSync = (doc: jsPDF, y: number, data: ServerLogReportData): number => {
  doc.addPage();
  y = 20;
  y = sectionTitle(doc, "Crawl Sync — SEO Health", y);
  const t = data.trendTotals;
  if (!t) {
    return subNote(
      doc,
      "No crawl-sync data available — upload a crawl export and/or GSC export alongside your logs to unlock this section.",
      y,
    );
  }
  y = subNote(
    doc,
    "Compares bot activity in your logs against your site's crawl file and Google Search Console data, to surface crawl-budget and indexing issues.",
    y,
  );
  y = dataTable(
    doc,
    y,
    [["Metric", "Count"]],
    [
      ["Crawled Pages", t.crawled_pages ?? 0],
      ["Orphan Pages (crawled by bots, not in crawl file)", t.orphan_pages ?? 0],
      ["Uncrawled URLs (in crawl file, never hit by a bot)", t.uncrawled_urls ?? 0],
      ["Dead Content", t.dead_content ?? 0],
      ["Wasted Crawl Budget", t.wasted_crawl_budget ?? 0],
      ["Unimportant Pages Crawled", t.unimportant_crawled ?? 0],
      ["Low-Frequency Important Pages", t.low_frequency_important ?? 0],
      ["Robots.txt Improvement Candidates", t.robots_txt_improvements ?? 0],
      ["Orphan Pages With GSC Traffic", t.orphans_gsc_traffic ?? 0],
    ],
    { headColor: DANGER_COLOR },
  );
  return y;
};

// ---------------------------------------------------------------------------
// 14. Traffic Diversity (Trend Totals)
// ---------------------------------------------------------------------------
export const renderTrendTotals = (doc: jsPDF, y: number, data: ServerLogReportData): number => {
  const t = data.trendTotals;
  y = ensureSpace(doc, y, 90);
  y = sectionTitle(doc, "Traffic Diversity", y);
  if (!t) {
    return subNote(doc, "No trend-totals data available.", y);
  }
  y = dataTable(
    doc,
    y,
    [["Dimension", "Distinct Values", "Total Hits"]],
    [
      ["Status Codes", t.status_count ?? 0, t.status_hits ?? 0],
      ["HTTP Methods", t.method_count ?? 0, t.method_hits ?? 0],
      ["User Agents", t.user_agent_count ?? 0, t.user_agent_hits ?? 0],
      ["Referrers", t.referer_count ?? 0, t.referer_hits ?? 0],
      ["Browsers", t.browser_count ?? 0, t.browser_hits ?? 0],
      ["Verified Bots", t.verified_count ?? 0, t.verified_hits ?? 0],
      ["Unique IPs", t.ip_count ?? 0, t.ip_hits ?? 0],
      ["Unique Paths", t.path_count ?? 0, t.path_hits ?? 0],
      ["Human Traffic", t.human_count ?? 0, t.human_hits ?? 0],
    ],
  );
  return y;
};

// ---------------------------------------------------------------------------
// 15. Top Lists (paths / status codes / user agents / referrers / browsers)
// ---------------------------------------------------------------------------
const topListTable = (
  doc: jsPDF,
  y: number,
  title: string,
  head: string,
  pairs: [string, number][] | undefined,
): number => {
  if (!pairs?.length) return y;
  y = ensureSpace(doc, y, 40);
  y = sectionTitle(doc, title, y);
  y = dataTable(
    doc,
    y,
    [[head, "Hits"]],
    pairs.slice(0, 15).map(([name, count]) => [truncate(String(name), 90), String(count)]),
    { fontSize: 7.5 },
  );
  return y;
};

export const renderTopLists = (doc: jsPDF, y: number, data: ServerLogReportData): number => {
  const t = data.trendTotals;
  if (!t) return y;
  doc.addPage();
  y = 20;
  y = sectionTitle(doc, "Top Paths & Segments", y);
  y = subNote(doc, "The most-requested values for each dimension, across the full log period.", y);
  y = topListTable(doc, y, "Top Paths", "Path", t.top_paths);
  y = topListTable(doc, y, "Top Status Codes", "Status Code", t.top_status_codes);
  y = topListTable(doc, y, "Top User Agents", "User Agent", t.top_user_agents);
  y = topListTable(doc, y, "Top Referrers", "Referrer", t.top_referrers);
  y = topListTable(doc, y, "Top Browsers", "Browser", t.top_browsers);
  return y;
};

// ---------------------------------------------------------------------------
// 16. Uploaded Log Batches
// ---------------------------------------------------------------------------
export const renderUploadedBatches = (doc: jsPDF, y: number, data: ServerLogReportData): number => {
  if (!data.uploadedLogFiles?.length) return y;
  doc.addPage();
  y = 20;
  y = sectionTitle(doc, "Uploaded Log Batches", y);
  y = dataTable(
    doc,
    y,
    [["Uploaded At", "Files", "Total Size"]],
    data.uploadedLogFiles.map((batch: any) => [
      fmtDate(batch.time),
      truncate((batch.names || []).join(", "), 70) || "-",
      formatBytes(batch.totalSize || batch.totalBatchSize || 0),
    ]),
    { fontSize: 7.5 },
  );
  return y;
};
