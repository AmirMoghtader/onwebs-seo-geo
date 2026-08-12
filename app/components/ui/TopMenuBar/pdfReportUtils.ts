// @ts-nocheck
// Generic, report-agnostic PDF building blocks shared by every report built
// off jsPDF + jspdf-autotable in this app (currently the deep-crawl report
// and the server-log report). Keeping these in one place means every report
// stays visually consistent (same margins, same header/table styling) and a
// fix — e.g. the white-on-blue heading text fix — only has to happen once.
import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export const MARGIN = 14;
export const BRAND_COLOR = [37, 99, 235]; // blue-600
export const DANGER_COLOR = [220, 38, 38]; // red-600

export interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

// 1-decimal percentage, "-" when there's nothing to divide by.
export const pct = (part: number | undefined, total: number | undefined): string => {
  if (!total || part === undefined || part === null) return "-";
  return `${((part / total) * 100).toFixed(1)}%`;
};

// 0-decimal percentage, "0%" when there's nothing to divide by — matches the
// formatting convention used by the app's own summary widgets.
export const pct0 = (part: number, total: number): string => {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
};

// Same as pct0 but capped at 100% for ratios that can technically exceed the
// denominator (e.g. counting occurrences rather than distinct pages).
export const pctCapped0 = (part: number, total: number): string => {
  if (!total) return "0%";
  return `${Math.min(Math.round((part / total) * 100), 100)}%`;
};

export const truncate = (str: string, max: number): string => {
  if (!str) return "";
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
};

export const formatBytes = (bytes: number): string => {
  if (!bytes || Number.isNaN(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

// Compact "1.2K" / "3.4M" formatting for large counts in chart axes/legends,
// where full digit-grouped numbers would crowd the layout.
export const compactNumber = (n: number): string => {
  if (n == null || Number.isNaN(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
};

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------

export const loadImageDimensions = (
  dataUrl: string,
): Promise<{ width: number; height: number }> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => resolve({ width: 1, height: 1 });
    img.src = dataUrl;
  });

// Fetches a public/ asset and returns it as a data URL + natural dimensions
// so it can be embedded via doc.addImage() at the correct aspect ratio.
// Resolves to null (never throws) so a missing/broken asset just means the
// report renders without it instead of failing outright.
export const loadImageDataUrl = async (path: string): Promise<LoadedImage | null> => {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const dims = await loadImageDimensions(dataUrl);
    return { dataUrl, width: dims.width, height: dims.height };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// PDF drawing helpers
// ---------------------------------------------------------------------------

export const sectionTitle = (doc: jsPDF, text: string, y: number): number => {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(text, MARGIN, y);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y + 2.5, pageWidth - MARGIN, y + 2.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  return y + 9;
};

export const subNote = (doc: jsPDF, text: string, y: number): number => {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  const lines = doc.splitTextToSize(text, pageWidth - MARGIN * 2);
  doc.text(lines, MARGIN, y);
  doc.setTextColor(0, 0, 0);
  return y + lines.length * 4 + 3;
};

export const ensureSpace = (doc: jsPDF, y: number, needed = 30): number => {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - 18) {
    doc.addPage();
    return 20;
  }
  return y;
};

export const kvTable = (doc: jsPDF, startY: number, rows: [string, string][]): number => {
  autoTable(doc, {
    startY,
    body: rows,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 1.6 },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 75, textColor: [51, 65, 85] },
      1: { textColor: [15, 23, 42] },
    },
    margin: { left: MARGIN, right: MARGIN },
  });
  // @ts-ignore - attached by the autotable plugin
  return doc.lastAutoTable.finalY + 8;
};

export const dataTable = (
  doc: jsPDF,
  startY: number,
  head: string[][],
  body: (string | number)[][],
  opts: Record<string, any> = {},
): number => {
  autoTable(doc, {
    startY,
    head,
    body,
    theme: opts.theme || "striped",
    // Explicit white text on every filled header row — relying on the
    // autoTable theme's default head textColor is fragile, since any future
    // headStyles override here could silently drop it and leave dark text
    // on a dark (blue/red) background.
    headStyles: {
      fillColor: opts.headColor || BRAND_COLOR,
      textColor: [255, 255, 255],
      fontSize: 8.5,
    },
    styles: {
      fontSize: opts.fontSize || 8.5,
      cellPadding: 1.8,
      overflow: "linebreak",
    },
    margin: { left: MARGIN, right: MARGIN },
    ...opts.extra,
  });
  // @ts-ignore
  return doc.lastAutoTable.finalY + 9;
};
