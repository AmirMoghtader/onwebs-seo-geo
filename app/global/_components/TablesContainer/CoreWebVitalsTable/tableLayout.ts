// Column configurations
export const initialColumnWidths = [
  "40px",   // ID
  "500px",  // URL
  "80px",   // Perf (M)
  "80px",   // Perf (D)
  "80px",   // Acc (M)
  "80px",   // Acc (D)
  "80px",   // BP (M)
  "80px",   // BP (D)
  "80px",   // SEO (M)
  "80px",   // SEO (D)
  "120px",  // Speed Index (M)
  "120px",  // Speed Index (D)
  "100px",  // LCP (M)
  "100px",  // LCP (D)
  "100px",  // CLS (M)
  "100px",  // CLS (D)
  "100px",  // FCP (M)
  "100px",  // FCP (D)
  "110px",  // Interactive (M)
  "110px",  // Interactive (D)
  "90px",   // TBT (M)
  "90px",   // TBT (D)
  "80px",   // Redirects
  "100px",  // TTFB (M)
  "100px",  // TTFB (D)
  "100px",  // DOM Nodes
  "120px",  // Byte Weight (M)
  "120px",  // Byte Weight (D)
];

export const initialColumnAlignments = Array(initialColumnWidths.length).fill("center");
// Set URL to left alignment
initialColumnAlignments[1] = "left";

/**
 * The value shown in each column, in header order.
 *
 * This used to live inside TableRow's useMemo, which meant the parent — the
 * component that actually owns the row array — had no way to ask "what does
 * column 3 show for this row?" and so could not sort. It is a pure function
 * now so TableRow and the sort comparator read from exactly one definition and
 * can never drift apart.
 */
export function getRowValues(row: any, index: number): any[] {
  const mobile = row?.psi_results?.Ok?.[0];
  const desktop = row?.psi_results?.Ok?.[1];

  const formatScore = (score: any) => {
    if (score === null || score === undefined) return "n/a";
    return Math.round(score * 100).toString();
  };

  const getAuditValue = (
    audit: any,
    options?: { isTime?: boolean; isBytes?: boolean },
  ) => {
    if (!audit) return "n/a";
    if (audit.numericValue !== undefined) {
      if (options?.isTime) {
        return `${Math.round(audit.numericValue)} ms`;
      }
      if (options?.isBytes) {
        const bytes = audit.numericValue;
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
      }
      const numValue = Number(audit.numericValue);
      if (isNaN(numValue)) return audit.displayValue || "n/a";

      return numValue < 1 && numValue > 0
        ? numValue.toFixed(3)
        : numValue > 100
          ? Math.round(numValue).toString()
          : numValue.toFixed(2);
    }
    return audit.displayValue || "n/a";
  };

  return [
    index + 1,
    row?.url || "",
    formatScore(mobile?.categories?.performance?.score),
    formatScore(desktop?.categories?.performance?.score),
    formatScore(mobile?.categories?.accessibility?.score),
    formatScore(desktop?.categories?.accessibility?.score),
    formatScore(mobile?.categories?.["best-practices"]?.score),
    formatScore(desktop?.categories?.["best-practices"]?.score),
    formatScore(mobile?.categories?.seo?.score),
    formatScore(desktop?.categories?.seo?.score),
    getAuditValue(mobile?.audits?.["speed-index"]),
    getAuditValue(desktop?.audits?.["speed-index"]),
    getAuditValue(mobile?.audits?.["largest-contentful-paint"]),
    getAuditValue(desktop?.audits?.["largest-contentful-paint"]),
    getAuditValue(mobile?.audits?.["cumulative-layout-shift"]),
    getAuditValue(desktop?.audits?.["cumulative-layout-shift"]),
    getAuditValue(mobile?.audits?.["first-contentful-paint"]),
    getAuditValue(desktop?.audits?.["first-contentful-paint"]),
    getAuditValue(mobile?.audits?.["interactive"]),
    getAuditValue(desktop?.audits?.["interactive"]),
    getAuditValue(mobile?.audits?.["total-blocking-time"]),
    getAuditValue(desktop?.audits?.["total-blocking-time"]),
    formatScore(mobile?.audits?.["redirects"]?.score),
    getAuditValue(mobile?.audits?.["server-response-time"], { isTime: true }),
    getAuditValue(desktop?.audits?.["server-response-time"], {
      isTime: true,
    }),
    getAuditValue(
      mobile?.audits?.["dom-size-insight"] || mobile?.audits?.["dom-size"],
    ),
    getAuditValue(mobile?.audits?.["total-byte-weight"], { isBytes: true }),
    getAuditValue(desktop?.audits?.["total-byte-weight"], { isBytes: true }),
  ];
}

export const headerTitles = [
  "ID",
  "URL",
  "Perf (M)",
  "Perf (D)",
  "Acc (M)",
  "Acc (D)",
  "BP (M)",
  "BP (D)",
  "SEO (M)",
  "SEO (D)",
  "Speed Index (M)",
  "Speed Index (D)",
  "LCP (M)",
  "LCP (D)",
  "CLS (M)",
  "CLS (D)",
  "FCP (M)",
  "FCP (D)",
  "Interactive (M)",
  "Interactive (D)",
  "TBT (M)",
  "TBT (D)",
  "Redirects",
  "TTFB (M)",
  "TTFB (D)",
  "DOM Nodes",
  "Byte Weight (M)",
  "Byte Weight (D)",
];
