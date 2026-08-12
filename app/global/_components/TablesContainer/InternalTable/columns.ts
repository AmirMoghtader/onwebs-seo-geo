// The Internal tab's column set, matching Screaming Frog's internal_all export
// column for column and in the same order.
//
// Every column carries its own accessor so the table, the sort comparator and
// the CSV export all read from one definition and cannot drift. Columns whose
// data the crawler does not collect are present but resolve to "" — leaving a
// visible gap is more honest than dropping the column and quietly diverging
// from the reference export.

import { titlePixels, descriptionPixels } from "../SubTables/DetailsTable/pixelWidth";

export interface InternalColumn {
  header: string;
  width: string;
  align: "left" | "center" | "right";
  value: (row: any, index: number, all?: any[]) => any;
  /** false when the crawler cannot supply this yet */
  supported?: boolean;
}

const REASON: Record<number, string> = {
  200: "OK", 201: "Created", 204: "No Content", 301: "Moved Permanently",
  302: "Found", 303: "See Other", 304: "Not Modified", 307: "Temporary Redirect",
  308: "Permanent Redirect", 400: "Bad Request", 401: "Unauthorized",
  403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed",
  408: "Request Timeout", 410: "Gone", 429: "Too Many Requests",
  500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway",
  503: "Service Unavailable", 504: "Gateway Timeout",
};

export function statusText(code: unknown): string {
  const n = Number(code);
  if (!Number.isFinite(n) || n === 0) return "";
  return (
    REASON[n] ||
    (n >= 500 ? "Server Error" : n >= 400 ? "Client Error" : n >= 300 ? "Redirect" : "OK")
  );
}

const s = (v: any) => (v === null || v === undefined ? "" : String(v));
const len = (v: any) => (v ? String(v).length : "");
const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : "");

const title = (r: any) => r?.title || "";
const desc = (r: any) => r?.metaDescription || "";

/** Sentence count, computed by the crawler where the page text still exists. */
function sentenceCount(r: any): number | "" {
  const n = Number(r?.sentenceCount);
  return Number.isFinite(n) && n > 0 ? n : "";
}

/**
 * Grams of CO2 per page view, using the Sustainable Web Design model at the
 * same order of magnitude Screaming Frog reports: bytes transferred × energy
 * per byte × grid carbon intensity.
 */
function co2mg(bytes: number): number | "" {
  if (!bytes) return "";
  const KWH_PER_BYTE = 0.000000000072;
  const GRAMS_PER_KWH = 442;
  return Number((bytes * KWH_PER_BYTE * GRAMS_PER_KWH * 1000).toFixed(3));
}

function carbonRating(mg: number | ""): string {
  if (mg === "") return "";
  const g = Number(mg) / 1000;
  if (g <= 0.095) return "A+";
  if (g <= 0.186) return "A";
  if (g <= 0.341) return "B";
  if (g <= 0.493) return "C";
  if (g <= 0.656) return "D";
  if (g <= 0.846) return "E";
  return "F";
}

function folderDepth(url: string): number | "" {
  if (!url) return "";
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return "";
  }
}

export const INTERNAL_COLUMNS: InternalColumn[] = [
  { header: "Address", width: "460px", align: "left", value: (r) => r?.address || "" },
  { header: "Content Type", width: "170px", align: "left", value: (r) => r?.contentType || "" },
  { header: "Status Code", width: "95px", align: "center", value: (r) => r?.statusCode ?? "" },
  { header: "Status", width: "130px", align: "left", value: (r) => statusText(r?.statusCode) },
  { header: "Indexability", width: "115px", align: "center", value: (r) => r?.indexability || "" },
  { header: "Indexability Status", width: "170px", align: "left", value: (r) => r?.indexabilityStatus || "" },

  { header: "Title 1", width: "300px", align: "left", value: title },
  { header: "Title 1 Length", width: "95px", align: "center", value: (r) => len(title(r)) },
  { header: "Title 1 Pixel Width", width: "115px", align: "center", value: (r) => (title(r) ? titlePixels(title(r)) : "") },

  { header: "Meta Description 1", width: "320px", align: "left", value: desc },
  { header: "Meta Description 1 Length", width: "120px", align: "center", value: (r) => len(desc(r)) },
  { header: "Meta Description 1 Pixel Width", width: "130px", align: "center", value: (r) => (desc(r) ? descriptionPixels(desc(r)) : "") },

  { header: "Meta Keywords 1", width: "260px", align: "left", value: (r) => r?.metaKeywords || "" },
  { header: "Meta Keywords 1 Length", width: "120px", align: "center", value: (r) => len(r?.metaKeywords) },

  { header: "H1-1", width: "260px", align: "left", value: (r) => r?.h1 || "" },
  { header: "H1-1 Length", width: "95px", align: "center", value: (r) => len(r?.h1) },
  { header: "H2-1", width: "260px", align: "left", value: (r) => r?.h2_1 || "" },
  { header: "H2-1 Length", width: "95px", align: "center", value: (r) => len(r?.h2_1) },
  { header: "H2-2", width: "260px", align: "left", value: (r) => r?.h2_2 || "" },
  { header: "H2-2 Length", width: "95px", align: "center", value: (r) => len(r?.h2_2) },

  { header: "Meta Robots 1", width: "180px", align: "left", value: (r) => r?.metaRobots1 || "" },
  { header: "Meta Robots 2", width: "180px", align: "left", value: (r) => r?.metaRobots2 || "" },
  { header: "X-Robots-Tag 1", width: "150px", align: "left", value: (r) => r?.xRobotsTag || "" },
  { header: "Meta Refresh 1", width: "150px", align: "left", value: (r) => r?.metaRefresh || "" },

  { header: "Canonical Link Element 1", width: "300px", align: "left", value: (r) => r?.canonical || "" },
  { header: 'rel="next" 1', width: "220px", align: "left", value: (r) => r?.relNext || "" },
  { header: 'rel="prev" 1', width: "220px", align: "left", value: (r) => r?.relPrev || "" },
  { header: 'HTTP rel="next" 1', width: "220px", align: "left", value: (r) => r?.httpRelNext || "" },
  { header: 'HTTP rel="prev" 1', width: "220px", align: "left", value: (r) => r?.httpRelPrev || "" },
  { header: "amphtml Link Element", width: "220px", align: "left", value: (r) => r?.amphtml || "" },

  { header: "Size (Bytes)", width: "110px", align: "center", value: (r) => num(r?.sizeBytes) },
  { header: "Transferred (Bytes)", width: "130px", align: "center", value: (r) => num(r?.transferredBytes) },
  { header: "Total Transferred (Bytes)", width: "150px", align: "center", value: (r) => num(r?.transferredBytes) },
  { header: "CO2 (mg)", width: "95px", align: "center", value: (r) => co2mg(Number(r?.transferredBytes) || 0) },
  { header: "Carbon Rating", width: "110px", align: "center", value: (r) => carbonRating(co2mg(Number(r?.transferredBytes) || 0)) },

  { header: "Word Count", width: "100px", align: "center", value: (r) => num(r?.wordCount) },
  { header: "Sentence Count", width: "110px", align: "center", value: (r) => sentenceCount(r) },
  {
    header: "Average Words Per Sentence",
    width: "150px",
    align: "center",
    value: (r) => {
      const w = Number(r?.wordCount);
      const sc = sentenceCount(r);
      if (!w || sc === "" || !sc) return "";
      return (w / Number(sc)).toFixed(2);
    },
  },
  { header: "Flesch Reading Ease Score", width: "150px", align: "center", value: (r) => r?.flesch ?? "" },
  { header: "Readability", width: "120px", align: "left", value: (r) => r?.readability || "" },
  { header: "Text Ratio", width: "95px", align: "center", value: (r) => r?.textRatio ?? "" },

  { header: "Crawl Depth", width: "100px", align: "center", value: (r) => (r?.depth === "" ? "" : num(r?.depth)) },
  { header: "Folder Depth", width: "100px", align: "center", value: (r) => folderDepth(r?.address) },
  { header: "Link Score", width: "95px", align: "center", value: (r) => (r?.linkScore === "" ? "" : num(r?.linkScore)) },

  { header: "Inlinks", width: "90px", align: "center", value: (r) => num(r?.inlinks) },
  { header: "Unique Inlinks", width: "110px", align: "center", value: (r) => num(r?.uniqueInlinks) },
  { header: "Unique JS Inlinks", width: "120px", align: "center", value: () => "", supported: false },
  {
    header: "% of Total",
    width: "95px",
    align: "center",
    // Share of all crawled pages that link here — SF's measure of how well
    // internally linked a page is.
    value: (r, _i, all) => {
      const total = (all || []).length;
      const uniq = Number(r?.uniqueInlinks);
      if (!total || !Number.isFinite(uniq)) return "";
      return ((uniq / total) * 100).toFixed(2);
    },
  },
  { header: "Outlinks", width: "90px", align: "center", value: (r) => num(r?.outlinks) },
  { header: "Unique Outlinks", width: "115px", align: "center", value: (r) => num(r?.uniqueOutlinks) },
  { header: "Unique JS Outlinks", width: "125px", align: "center", value: () => "", supported: false },
  { header: "External Outlinks", width: "120px", align: "center", value: (r) => num(r?.externalOutlinks) },
  { header: "Unique External Outlinks", width: "150px", align: "center", value: (r) => num(r?.uniqueExternalOutlinks) },
  { header: "Unique External JS Outlinks", width: "160px", align: "center", value: () => "", supported: false },

  { header: "Closest Near Duplicate Match", width: "170px", align: "center", value: () => "", supported: false },
  { header: "No. Near Duplicates", width: "130px", align: "center", value: () => "", supported: false },
  { header: "Spelling Errors", width: "110px", align: "center", value: () => "", supported: false },
  { header: "Grammar Errors", width: "115px", align: "center", value: () => "", supported: false },

  { header: "Hash", width: "260px", align: "left", value: (r) => r?.hash || "" },
  { header: "Response Time", width: "115px", align: "center", value: (r) => r?.responseTime ?? "" },
  { header: "Last Modified", width: "190px", align: "left", value: (r) => r?.lastModified || "" },
  { header: "Redirect URL", width: "280px", align: "left", value: (r) => r?.redirectUrl || "" },
  { header: "Redirect Type", width: "130px", align: "left", value: (r) => r?.redirectType || "" },
  { header: "Cookies", width: "90px", align: "center", value: (r) => num(r?.cookies) },
  { header: "Language", width: "95px", align: "center", value: (r) => r?.language || "" },
  { header: "HTTP Version", width: "110px", align: "center", value: (r) => r?.httpVersion || "" },
  { header: "Mobile Alternate Link", width: "220px", align: "left", value: (r) => r?.mobileAlternate || "" },

  { header: "Closest Semantically Similar Address", width: "200px", align: "left", value: () => "", supported: false },
  { header: "Semantic Similarity Score", width: "150px", align: "center", value: () => "", supported: false },
  { header: "No. Semantically Similar", width: "150px", align: "center", value: () => "", supported: false },
  { header: "Semantic Relevance Score", width: "150px", align: "center", value: () => "", supported: false },

  {
    header: "URL Encoded Address",
    width: "300px",
    align: "left",
    value: (r) => {
      try {
        return r?.address ? encodeURI(r.address) : "";
      } catch {
        return r?.address || "";
      }
    },
  },
  { header: "Crawl Timestamp", width: "170px", align: "left", value: (r) => r?.crawlTimestamp || "" },
];

export const headerTitles = INTERNAL_COLUMNS.map((c) => c.header);
export const initialColumnWidths = INTERNAL_COLUMNS.map((c) => c.width);
export const initialColumnAlignments = INTERNAL_COLUMNS.map((c) => c.align);

/** Columns shown by default — the rest are available from the column picker. */
export const DEFAULT_VISIBLE = INTERNAL_COLUMNS.map(
  (c, i) => c.supported !== false && i < 20,
);

export function getRowValues(row: any, index: number, all?: any[]): any[] {
  return INTERNAL_COLUMNS.map((c) => c.value(row, index, all));
}
