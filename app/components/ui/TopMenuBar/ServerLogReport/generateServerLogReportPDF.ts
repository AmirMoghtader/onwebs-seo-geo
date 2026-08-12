// @ts-nocheck
// Server Log Report — orchestrates the cover page and every section in
// sections.ts into one PDF, then saves it. Mirrors the structure of
// ../CrawlReport/generateCrawlReportPDF.ts (same shared pdfReportUtils,
// same save-dialog pattern) but reads from the server-log analyser's store
// instead of the crawl store — see fetchServerLogReportData.ts for what's
// gathered and why.
import { jsPDF } from "jspdf";
import { loadImageDataUrl, pct0 } from "../pdfReportUtils";
import { fetchServerLogReportData } from "./fetchServerLogReportData";
import {
  renderExecutiveSummary,
  renderTrafficOverview,
  renderStatusCodes,
  renderFileTypes,
  renderBandwidth,
  renderCrawlerTraffic,
  renderIndexingCrawlers,
  renderRetrievalAgents,
  renderAgenticBots,
  renderUserAgents,
  renderReferrers,
  renderContentSegments,
  renderCrawlSync,
  renderTrendTotals,
  renderTopLists,
  renderUploadedBatches,
} from "./sections";

export interface ServerLogReportResult {
  success: boolean;
  message: string;
}

export async function generateServerLogReportPDF(): Promise<ServerLogReportResult> {
  const data = await fetchServerLogReportData();
  if (!data) {
    return {
      success: false,
      message: "No server log data available yet. Upload and process some logs first.",
    };
  }

  const generatedAt = new Date();
  const [logoIcon, logoWordmark] = await Promise.all([
    loadImageDataUrl("/icon.png"),
    loadImageDataUrl("/onwebs-wordmark.png"),
  ]);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // -------------------------------------------------------------------
  // Cover page — same dark-slate branding treatment as the crawl report.
  // -------------------------------------------------------------------
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  let coverY = 36;
  if (logoIcon) {
    const iconH = 24;
    const iconW = iconH * (logoIcon.width / logoIcon.height);
    doc.addImage(logoIcon.dataUrl, "PNG", pageWidth / 2 - iconW / 2, coverY, iconW, iconH);
    coverY += iconH + 8;
  }
  if (logoWordmark) {
    const wmW = 62;
    const wmH = wmW * (logoWordmark.height / logoWordmark.width);
    doc.addImage(logoWordmark.dataUrl, "PNG", pageWidth / 2 - wmW / 2, coverY, wmW, wmH);
    coverY += wmH + 14;
  } else {
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(10);
    doc.text("AMIR SEO", pageWidth / 2, coverY + 6, { align: "center" });
    coverY += 20;
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.text("Server Log Report", pageWidth / 2, coverY, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Generated ${generatedAt.toLocaleDateString()} at ${generatedAt.toLocaleTimeString()}`,
    pageWidth / 2,
    coverY + 11,
    { align: "center" },
  );

  const o = data.overview || {};
  const highlightStats: [string, string | number][] = [
    ["Total Requests", o.line_count ?? 0],
    ["Crawler Traffic", pct0(o.crawler_count ?? 0, o.line_count ?? 0)],
    ["Unique IPs", o.unique_ips ?? 0],
    ["Success Rate", `${o.success_rate != null ? Number(o.success_rate).toFixed(0) : 0}%`],
  ];
  const boxWidth = 40;
  const boxGap = 6;
  const totalBoxWidth = highlightStats.length * boxWidth + (highlightStats.length - 1) * boxGap;
  let bx = pageWidth / 2 - totalBoxWidth / 2;
  const boxY = coverY + 30;
  highlightStats.forEach(([label, value]) => {
    doc.setFillColor(30, 41, 59);
    doc.roundedRect(bx, boxY, boxWidth, 26, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(String(value), bx + boxWidth / 2, boxY + 12, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(label, bx + boxWidth / 2, boxY + 19, { align: "center" });
    bx += boxWidth + boxGap;
  });

  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    "Traffic, crawler, and SEO health analysis of the server access logs.",
    pageWidth / 2,
    pageHeight - 20,
    { align: "center" },
  );

  // -------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------
  doc.addPage();
  let y = 20;
  y = renderExecutiveSummary(doc, y, data);
  y = renderTrafficOverview(doc, y, data);
  y = renderStatusCodes(doc, y, data);
  y = renderFileTypes(doc, y, data);
  y = renderBandwidth(doc, y, data);
  y = renderCrawlerTraffic(doc, y, data);
  y = renderIndexingCrawlers(doc, y, data);
  y = renderRetrievalAgents(doc, y, data);
  y = renderAgenticBots(doc, y, data);
  y = renderUserAgents(doc, y, data);
  y = renderReferrers(doc, y, data);
  y = renderContentSegments(doc, y, data);
  y = renderCrawlSync(doc, y, data);
  y = renderTrendTotals(doc, y, data);
  y = renderTopLists(doc, y, data);
  y = renderUploadedBatches(doc, y, data);

  // -------------------------------------------------------------------
  // Header + footer on every page except the cover
  // -------------------------------------------------------------------
  const totalDocPages = doc.internal.getNumberOfPages();
  const headerIconH = 4.5;
  const headerIconW = logoIcon ? headerIconH * (logoIcon.width / logoIcon.height) : 0;
  const headerRowTopY = 5.5;
  const headerRowCenterY = headerRowTopY + headerIconH / 2;
  for (let i = 2; i <= totalDocPages; i++) {
    doc.setPage(i);
    if (logoIcon) {
      doc.addImage(logoIcon.dataUrl, "PNG", 14, headerRowTopY, headerIconW, headerIconH);
    }
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      "Server Log Report",
      14 + (logoIcon ? headerIconW + 2.5 : 0),
      headerRowCenterY,
      { baseline: "middle" },
    );
    doc.setDrawColor(226, 232, 240);
    doc.line(14, 12, pageWidth - 14, 12);

    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(generatedAt.toLocaleDateString(), 14, pageHeight - 10);
    doc.text(`Page ${i - 1} of ${totalDocPages - 1}`, pageWidth - 14, pageHeight - 10, {
      align: "right",
    });
  }

  const filename = `Server-Log-Report-${generatedAt.toISOString().slice(0, 10)}.pdf`;

  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      defaultPath: filename,
      filters: [{ name: "PDF Files", extensions: ["pdf"] }],
    });
    if (!path) {
      return { success: false, message: "Export cancelled." };
    }
    const pdfBytes = doc.output("arraybuffer");
    await writeFile(path, new Uint8Array(pdfBytes));
    return { success: true, message: `Report saved to ${path}` };
  } catch (error) {
    console.error(
      "Failed to save PDF via Tauri dialog, falling back to browser download:",
      error,
    );
    doc.save(filename);
    return { success: true, message: "Report downloaded." };
  }
}
