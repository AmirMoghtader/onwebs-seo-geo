// @ts-nocheck
// Generic chart-drawing primitives for PDF reports, built on jsPDF's own
// vector drawing (rects/triangles/lines) rather than trying to rasterize the
// app's live Recharts components — there's no headless browser context
// available at report-generation time to screenshot them from. Two shapes
// cover every chart the Server Log Report needs: a stacked bar chart (used
// for all 5 timeline series) and a pie chart (used for every categorical
// breakdown — file types, status codes, crawlers, user agents, etc.).
import type { jsPDF } from "jspdf";
import { MARGIN, compactNumber } from "../pdfReportUtils";

export interface ChartSeries {
  key: string;
  label: string;
  color: [number, number, number];
}

// A reusable categorical palette for pie slices where the caller doesn't
// care about specific semantic colors (unlike bar-chart series, which are
// given deliberate colors per metric — e.g. red for 5xx errors).
export const CHART_PALETTE: [number, number, number][] = [
  [37, 99, 235], // blue-600
  [16, 185, 129], // emerald-500
  [245, 158, 11], // amber-500
  [239, 68, 68], // red-500
  [139, 92, 246], // violet-500
  [6, 182, 212], // cyan-500
  [236, 72, 153], // pink-500
  [132, 204, 22], // lime-500
  [249, 115, 22], // orange-500
  [100, 116, 139], // slate-500 ("Other" bucket lands here by convention)
];

const AXIS_COLOR = [203, 213, 225]; // slate-300
const AXIS_LABEL_COLOR = [100, 116, 139]; // slate-500

// ---------------------------------------------------------------------------
// Stacked bar chart — used for every timeline (traffic, status, crawler,
// file type, bandwidth). A single-series call just renders plain bars.
// ---------------------------------------------------------------------------

// Merges adjacent points by summation so a long timeline still renders as a
// legible number of bars in print — summation (not averaging) keeps "total
// requests in this window" semantics correct after merging periods.
const downsampleSeries = (
  data: Record<string, any>[],
  dateKey: string,
  seriesKeys: string[],
  maxBars: number,
): Record<string, any>[] => {
  if (data.length <= maxBars) return data;
  const bucketSize = Math.ceil(data.length / maxBars);
  const buckets: Record<string, any>[] = [];
  for (let i = 0; i < data.length; i += bucketSize) {
    const chunk = data.slice(i, i + bucketSize);
    const bucket: Record<string, any> = { [dateKey]: chunk[0][dateKey] };
    for (const key of seriesKeys) {
      bucket[key] = chunk.reduce((sum, d) => sum + (Number(d[key]) || 0), 0);
    }
    buckets.push(bucket);
  }
  return buckets;
};

export interface StackedBarChartOptions {
  maxBars?: number;
  height?: number;
  gridLines?: number;
}

// Draws a stacked bar chart at (x, y) spanning `width`mm, and returns the y
// position immediately below the chart + legend so the caller can keep
// laying out content underneath it.
export const drawStackedBarChart = (
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  rawData: Record<string, any>[],
  series: ChartSeries[],
  dateKey: string,
  options: StackedBarChartOptions = {},
): number => {
  const height = options.height ?? 55;
  const gridLines = options.gridLines ?? 4;
  const maxBars = options.maxBars ?? 30;

  if (!rawData?.length || !series.length) {
    doc.setFontSize(8.5);
    doc.setTextColor(...AXIS_LABEL_COLOR);
    doc.text("No data available for this chart.", x, y + 10);
    doc.setTextColor(0, 0, 0);
    return y + 18;
  }

  const data = downsampleSeries(
    rawData,
    dateKey,
    series.map((s) => s.key),
    maxBars,
  );

  const plotLeft = x + 16; // room for Y-axis value labels
  const plotWidth = width - 16;
  const plotTop = y;
  const plotBottom = y + height;

  const maxTotal = Math.max(
    1,
    ...data.map((d) => series.reduce((sum, s) => sum + (Number(d[s.key]) || 0), 0)),
  );

  // Gridlines + Y-axis labels
  doc.setDrawColor(...AXIS_COLOR);
  doc.setLineWidth(0.2);
  doc.setFontSize(6.5);
  for (let i = 0; i <= gridLines; i++) {
    const gy = plotBottom - (height * i) / gridLines;
    doc.line(plotLeft, gy, x + width, gy);
    const value = (maxTotal * i) / gridLines;
    doc.setTextColor(...AXIS_LABEL_COLOR);
    doc.text(compactNumber(Math.round(value)), plotLeft - 2, gy + 1, { align: "right" });
  }
  doc.setTextColor(0, 0, 0);

  // Bars
  const barGap = 0.6;
  const barWidth = Math.max(0.6, plotWidth / data.length - barGap);
  data.forEach((d, i) => {
    let stackY = plotBottom;
    const barX = plotLeft + i * (barWidth + barGap);
    for (const s of series) {
      const value = Number(d[s.key]) || 0;
      if (value <= 0) continue;
      const barHeight = (value / maxTotal) * height;
      doc.setFillColor(...s.color);
      doc.rect(barX, stackY - barHeight, barWidth, barHeight, "F");
      stackY -= barHeight;
    }
  });

  // X-axis labels — at most ~7 evenly spaced, to avoid overlapping text.
  const labelCount = Math.min(7, data.length);
  doc.setFontSize(6.5);
  doc.setTextColor(...AXIS_LABEL_COLOR);
  for (let i = 0; i < labelCount; i++) {
    const dataIndex = Math.round((i / Math.max(1, labelCount - 1)) * (data.length - 1));
    const barX = plotLeft + dataIndex * (barWidth + barGap) + barWidth / 2;
    const label = String(data[dataIndex][dateKey] ?? "").slice(0, 10);
    doc.text(label, barX, plotBottom + 4, { align: "center", angle: 0 });
  }
  doc.setTextColor(0, 0, 0);

  const legendY = plotBottom + 10;
  drawLegendRow(doc, x, legendY, series.map((s) => ({ label: s.label, color: s.color })));

  return legendY + 6;
};

// ---------------------------------------------------------------------------
// Pie chart — used for every categorical breakdown (file types, statuses,
// crawlers, user agents, referrers, content segments, bot categories).
// ---------------------------------------------------------------------------

export interface PieChartOptions {
  maxSlices?: number;
  legendWidth?: number;
}

// Draws a pie at (centerX, centerY) with the given radius, plus a legend to
// its right listing each slice's name/count/percentage. Returns the y
// position below whichever is taller (circle or legend).
export const drawPieChart = (
  doc: jsPDF,
  centerX: number,
  centerY: number,
  radius: number,
  data: { name: string; value: number }[],
  options: PieChartOptions = {},
): number => {
  const maxSlices = options.maxSlices ?? 8;

  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, maxSlices);
  const rest = sorted.slice(maxSlices);
  const restTotal = rest.reduce((sum, d) => sum + d.value, 0);
  const slices = restTotal > 0 ? [...top, { name: "Other", value: restTotal }] : top;

  const total = slices.reduce((sum, d) => sum + d.value, 0);

  if (!slices.length || total <= 0) {
    doc.setFontSize(8.5);
    doc.setTextColor(...AXIS_LABEL_COLOR);
    doc.text("No data available.", centerX - radius, centerY);
    doc.setTextColor(0, 0, 0);
    return centerY + 10;
  }

  // Draw each wedge as a fan of thin triangles approximating the arc — jsPDF
  // has no native pie-slice primitive, but this is indistinguishable from a
  // true arc at print resolution with a small enough angular step.
  let startAngle = -Math.PI / 2; // 12 o'clock
  const STEP = (4 * Math.PI) / 180; // 4 degrees per triangle
  slices.forEach((slice, i) => {
    const sweep = (slice.value / total) * Math.PI * 2;
    const endAngle = startAngle + sweep;
    const color = CHART_PALETTE[i % CHART_PALETTE.length];
    doc.setFillColor(...color);

    let a = startAngle;
    while (a < endAngle) {
      const next = Math.min(a + STEP, endAngle);
      const x1 = centerX + radius * Math.cos(a);
      const y1 = centerY + radius * Math.sin(a);
      const x2 = centerX + radius * Math.cos(next);
      const y2 = centerY + radius * Math.sin(next);
      doc.triangle(centerX, centerY, x1, y1, x2, y2, "F");
      a = next;
    }
    startAngle = endAngle;
  });

  // Legend to the right of the pie.
  const legendX = centerX + radius + 10;
  let legendY = centerY - radius;
  doc.setFontSize(7.5);
  slices.forEach((slice, i) => {
    const color = CHART_PALETTE[i % CHART_PALETTE.length];
    doc.setFillColor(...color);
    doc.rect(legendX, legendY - 2.5, 3, 3, "F");
    doc.setTextColor(30, 41, 59);
    const pctLabel = `${((slice.value / total) * 100).toFixed(1)}%`;
    doc.text(`${slice.name} — ${compactNumber(slice.value)} (${pctLabel})`, legendX + 5, legendY);
    legendY += 5;
  });
  doc.setTextColor(0, 0, 0);

  return Math.max(centerY + radius + 6, legendY + 4);
};

// ---------------------------------------------------------------------------
// Shared legend row (used standalone by drawStackedBarChart, and reusable
// wherever a report needs a simple color-key row without a full chart).
// ---------------------------------------------------------------------------

export const drawLegendRow = (
  doc: jsPDF,
  x: number,
  y: number,
  items: { label: string; color: [number, number, number] }[],
): void => {
  const pageWidth = doc.internal.pageSize.getWidth();
  let cx = x;
  let cy = y;
  doc.setFontSize(7.5);
  for (const item of items) {
    const labelWidth = doc.getTextWidth(item.label);
    const entryWidth = 6 + labelWidth + 6;
    if (cx + entryWidth > pageWidth - MARGIN) {
      cx = x;
      cy += 5;
    }
    doc.setFillColor(...item.color);
    doc.rect(cx, cy - 2.5, 3, 3, "F");
    doc.setTextColor(30, 41, 59);
    doc.text(item.label, cx + 5, cy);
    cx += entryWidth;
  }
  doc.setTextColor(0, 0, 0);
};
