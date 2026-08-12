// Column layout for the unified Internal view, modelled on Screaming Frog's
// "Internal" tab: every internal URL the crawl touched — pages, images, JS,
// CSS, documents — in ONE table, distinguished by Content Type.

export const initialColumnWidths = [
  "50px", // ID
  "minmax(460px, auto)", // Address
  "170px", // Content Type
  "90px", // Status Code
  "110px", // Status
  "110px", // Indexability
  "300px", // Title
  "80px", // Title Length
  "300px", // Meta Description
  "80px", // Desc Length
  "260px", // H1
  "80px", // H1 Length
  "90px", // Word Count
  "90px", // Size
  "80px", // Depth
  "90px", // Link Score
  "230px", // Found At
];

export const initialColumnAlignments = [
  "center",
  "left",
  "left",
  "center",
  "left",
  "center",
  "left",
  "center",
  "left",
  "center",
  "left",
  "center",
  "center",
  "center",
  "center",
  "center",
  "left",
];

export const headerTitles = [
  "ID",
  "Address",
  "Content Type",
  "Status Code",
  "Status",
  "Indexability",
  "Title 1",
  "Title 1 Length",
  "Meta Description 1",
  "Meta Desc 1 Length",
  "H1-1",
  "H1-1 Length",
  "Word Count",
  "Size",
  "Crawl Depth",
  "Link Score",
  "Found At",
];

/**
 * HTTP reason phrase, which Screaming Frog shows in its own "Status" column
 * beside the numeric code. Derived here rather than stored, since the crawler
 * only keeps the number.
 */
const REASON: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  410: "Gone",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

export function statusText(code: unknown): string {
  const n = Number(code);
  if (!Number.isFinite(n) || n === 0) return "";
  return REASON[n] || (n >= 500 ? "Server Error" : n >= 400 ? "Client Error" : n >= 300 ? "Redirect" : "OK");
}

export function getRowValues(row: any, index: number): any[] {
  return [
    index + 1,
    row?.address || "",
    row?.contentType || "",
    row?.statusCode ?? "",
    statusText(row?.statusCode),
    row?.indexability || "",
    row?.title || "",
    row?.title ? String(row.title).length : "",
    row?.metaDescription || "",
    row?.metaDescription ? String(row.metaDescription).length : "",
    row?.h1 || "",
    row?.h1 ? String(row.h1).length : "",
    row?.wordCount ?? "",
    row?.size || "",
    row?.depth ?? "",
    row?.linkScore ?? "",
    row?.foundAt || "",
  ];
}

export interface InternalFilter {
  key: string;
  label: string;
  match: (row: any) => boolean;
}

const ct = (row: any) => String(row?.contentType || "").toLowerCase();

export const INTERNAL_FILTERS: InternalFilter[] = [
  { key: "all", label: "All", match: () => true },
  { key: "html", label: "HTML", match: (r) => ct(r).includes("html") },
  {
    key: "javascript",
    label: "JavaScript",
    match: (r) => ct(r).includes("javascript") || ct(r).includes("ecmascript"),
  },
  { key: "css", label: "CSS", match: (r) => ct(r).includes("css") },
  { key: "images", label: "Images", match: (r) => ct(r).startsWith("image") },
  {
    key: "media",
    label: "Media",
    match: (r) => ct(r).startsWith("video") || ct(r).startsWith("audio"),
  },
  { key: "fonts", label: "Fonts", match: (r) => ct(r).includes("font") },
  { key: "xml", label: "XML", match: (r) => ct(r).includes("xml") },
  { key: "pdf", label: "PDF", match: (r) => ct(r).includes("pdf") },
  {
    key: "other",
    label: "Other",
    match: (r) => {
      const t = ct(r);
      if (!t) return true;
      return ![
        "html",
        "javascript",
        "ecmascript",
        "css",
        "image",
        "video",
        "audio",
        "font",
        "xml",
        "pdf",
      ].some((k) => t.includes(k));
    },
  },
];
