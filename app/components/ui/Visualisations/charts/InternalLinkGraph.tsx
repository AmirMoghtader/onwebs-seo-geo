// @ts-nocheck
// d3-force has no bundled type declarations in this project (it's a
// transitive dep of `d3`, not a direct one), so this file opts out of
// type-checking rather than hand-rolling ambient types for it.
import React, { useMemo, useRef, useState, useCallback } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
} from "d3-force";
import { Search, X, ExternalLink, Copy, Home } from "lucide-react";
import { toast } from "sonner";
import type { VisualisationChartProps } from "../types";
import { STATUS } from "../shared/colors";
import EmptyState from "../shared/EmptyState";
import openBrowserWindow from "@/app/Hooks/OpenBrowserWindow";

const MAX_NODES = 220;
const WIDTH = 760;
const HEIGHT = 480;

function statusColorFor(status) {
  if (!status) return "#94a3b8";
  if (status >= 200 && status < 300) return STATUS.good;
  if (status >= 300 && status < 400) return STATUS.warning;
  if (status >= 400) return STATUS.critical;
  return "#94a3b8";
}

function getPageDetails(crawlData, url) {
  return crawlData.find((item) => item?.url === url) || null;
}

// The flagship "site as a network" view — a force-directed diagram of
// internal links, the same idea Screaming Frog's crawl diagram uses, but
// with the interaction layer that makes it actually useful for an audit:
// click any node for its full SEO profile, search to locate a URL, drag to
// pan, and directional arrows + a dedicated inbound/outbound count instead
// of a single opaque "degree" number.
export default function InternalLinkGraph({ crawlData, aggregatedData, isDark }) {
  const rawLinks = aggregatedData?.internalLinks || [];

  const { nodes, links, inDegreeById, outDegreeById, rootId, truncated, totalDiscovered } = useMemo(() => {
    if (rawLinks.length === 0) {
      return {
        nodes: [],
        links: [],
        inDegreeById: new Map(),
        outDegreeById: new Map(),
        rootId: null,
        truncated: false,
        totalDiscovered: 0,
      };
    }

    const statusByUrl = new Map();
    const depthByUrl = new Map();
    for (const item of crawlData) {
      if (!item?.url) continue;
      if (typeof item.status_code === "number") statusByUrl.set(item.url, item.status_code);
      if (typeof item.url_depth === "number") depthByUrl.set(item.url, item.url_depth);
    }

    // True inbound/outbound counts computed from the FULL edge list, before
    // any truncation for display — so the detail panel is always accurate
    // even for nodes whose neighbours got trimmed off the visible graph.
    const inDegree = new Map();
    const outDegree = new Map();
    const edgeSet = new Set();
    const rawEdges = [];

    for (const link of rawLinks) {
      const source = link?.page;
      const target = link?.url;
      if (!source || !target || source === target) continue;
      const key = `${source} ${target}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      rawEdges.push({ source, target });
      outDegree.set(source, (outDegree.get(source) || 0) + 1);
      inDegree.set(target, (inDegree.get(target) || 0) + 1);
    }

    const totalDegree = new Map();
    const allIds = new Set([...inDegree.keys(), ...outDegree.keys()]);
    for (const id of allIds) {
      totalDegree.set(id, (inDegree.get(id) || 0) + (outDegree.get(id) || 0));
    }

    const topIds = new Set(
      Array.from(totalDegree.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_NODES)
        .map(([id]) => id),
    );

    // Always keep the crawl root visible even if it didn't make the
    // top-N cut (rare, but it's the single most important node on the graph).
    let rootId = null;
    let rootDepth = Infinity;
    for (const id of allIds) {
      const depth = depthByUrl.get(id);
      if (depth !== undefined && depth < rootDepth) {
        rootDepth = depth;
        rootId = id;
      }
    }
    if (rootId && !topIds.has(rootId) && topIds.size >= MAX_NODES) {
      const [weakestId] = Array.from(topIds).sort((a, b) => (totalDegree.get(a) || 0) - (totalDegree.get(b) || 0));
      topIds.delete(weakestId);
      topIds.add(rootId);
    }

    const filteredEdges = rawEdges.filter((e) => topIds.has(e.source) && topIds.has(e.target));

    const graphNodes = Array.from(topIds).map((id) => ({
      id,
      inDegree: inDegree.get(id) || 0,
      outDegree: outDegree.get(id) || 0,
      statusColor: statusColorFor(statusByUrl.get(id)),
    }));

    return {
      nodes: graphNodes,
      links: filteredEdges,
      inDegreeById: inDegree,
      outDegreeById: outDegree,
      rootId,
      truncated: allIds.size > MAX_NODES,
      totalDiscovered: allIds.size,
    };
  }, [rawLinks, crawlData]);

  const layout = useMemo(() => {
    if (nodes.length === 0) return { nodes: [], links: [] };

    // Clone nodes — d3-force mutates x/y/vx/vy in place.
    const simNodes = nodes.map((n) => ({ ...n }));
    const simLinks = links.map((l) => ({ ...l }));

    const simulation = forceSimulation(simNodes)
      .force(
        "link",
        forceLink(simLinks)
          .id((d) => d.id)
          .distance(38)
          .strength(0.35),
      )
      .force("charge", forceManyBody().strength(-90))
      .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
      .force("collide", forceCollide((d) => 4 + Math.sqrt(d.inDegree + d.outDegree) * 2))
      .stop();

    const TICKS = 220;
    for (let i = 0; i < TICKS; i++) simulation.tick();

    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const resolvedLinks = simLinks
      .map((l) => {
        const s = byId.get(typeof l.source === "string" ? l.source : l.source.id);
        const t = byId.get(typeof l.target === "string" ? l.target : l.target.id);
        if (!s || !t) return null;
        return { ...l, source: s.id, target: t.id, sx: s.x ?? 0, sy: s.y ?? 0, tx: t.x ?? 0, ty: t.y ?? 0 };
      })
      .filter(Boolean);

    return { nodes: simNodes, links: resolvedLinks };
  }, [nodes, links]);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const dragState = useRef(null);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom((z) => Math.min(4, Math.max(0.4, z - e.deltaY * 0.001)));
  }, []);

  const handleMouseDown = useCallback((e) => {
    dragState.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e) => {
    if (!dragState.current) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    setPan({ x: dragState.current.panX + dx, y: dragState.current.panY + dy });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragState.current = null;
  }, []);

  if (!crawlData.length) return <EmptyState />;
  if (rawLinks.length === 0) {
    return (
      <EmptyState message="Internal link data isn't available yet — this populates once a Deep Crawl finishes." />
    );
  }

  const activeId = selectedId || hoveredId;

  const neighborIds = activeId
    ? new Set(
        layout.links
          .filter((l) => l.source === activeId || l.target === activeId)
          .flatMap((l) => [l.source, l.target]),
      )
    : null;

  const searchTerm = search.trim().toLowerCase();
  const matchedIds = searchTerm
    ? new Set(layout.nodes.filter((n) => n.id.toLowerCase().includes(searchTerm)).map((n) => n.id))
    : null;

  const focusIds = neighborIds || matchedIds;

  const inboundEdges = selectedId ? layout.links.filter((l) => l.target === selectedId) : [];
  const outboundEdges = selectedId ? layout.links.filter((l) => l.source === selectedId) : [];

  const selectedDetails = selectedId ? getPageDetails(crawlData, selectedId) : null;

  const copyUrl = (url) => {
    navigator.clipboard.writeText(url).then(() => toast.success("URL در کلیپ‌بورد کپی شد"));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-3 mb-1.5 flex-wrap">
        <p className="text-[10px] text-slate-500 dark:text-slate-400 flex-1 min-w-[200px]">
          {truncated
            ? `Showing the ${MAX_NODES} best-linked pages of ${totalDiscovered.toLocaleString()} discovered. `
            : `All ${totalDiscovered.toLocaleString()} internally-linked pages. `}
          Drag to pan, scroll to zoom, click a node for details.
        </p>
        <div className="relative">
          <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="یافتن یک URL…"
            className="text-[10px] pl-6 pr-2 py-1 w-40 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 outline-none focus:border-sky-400 dark:text-white"
          />
        </div>
        <div className="flex items-center gap-2.5 text-[9px] shrink-0">
          <LegendDot color={STATUS.good} label="2xx" />
          <LegendDot color={STATUS.warning} label="3xx" />
          <LegendDot color={STATUS.critical} label="4xx/5xx" />
          <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
            <Home className="w-2.5 h-2.5" /> URL شروع
          </span>
        </div>
      </div>

      <div className="flex-1 flex gap-3 min-h-0">
        <div
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="flex-1 min-h-[280px] rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 overflow-hidden cursor-grab active:cursor-grabbing"
        >
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height="100%" style={{ display: "block" }}>
            <defs>
              <marker id="arrow-in" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={STATUS.info} />
              </marker>
              <marker id="arrow-out" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={STATUS.serious} />
              </marker>
            </defs>
            <g transform={`translate(${pan.x}, ${pan.y})`}>
              <g transform={`translate(${WIDTH / 2}, ${HEIGHT / 2}) scale(${zoom}) translate(${-WIDTH / 2}, ${-HEIGHT / 2})`}>
                {layout.links.map((l, i) => {
                  const isInbound = selectedId && l.target === selectedId;
                  const isOutbound = selectedId && l.source === selectedId;
                  if (isInbound || isOutbound) return null; // drawn separately, on top
                  const isDimmed = focusIds && !focusIds.has(l.source) && !focusIds.has(l.target);
                  return (
                    <line
                      key={i}
                      x1={l.sx}
                      y1={l.sy}
                      x2={l.tx}
                      y2={l.ty}
                      stroke={isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.10)"}
                      strokeWidth={1}
                      opacity={isDimmed ? 0.25 : 1}
                    />
                  );
                })}
                {inboundEdges.map((l, i) => (
                  <line
                    key={`in-${i}`}
                    x1={l.sx}
                    y1={l.sy}
                    x2={l.tx}
                    y2={l.ty}
                    stroke={STATUS.info}
                    strokeWidth={1.4}
                    markerEnd="url(#arrow-in)"
                  />
                ))}
                {outboundEdges.map((l, i) => (
                  <line
                    key={`out-${i}`}
                    x1={l.sx}
                    y1={l.sy}
                    x2={l.tx}
                    y2={l.ty}
                    stroke={STATUS.serious}
                    strokeWidth={1.4}
                    markerEnd="url(#arrow-out)"
                  />
                ))}
                {layout.nodes.map((n) => {
                  const isDimmed = focusIds && !focusIds.has(n.id) && n.id !== activeId;
                  const isSelected = n.id === selectedId;
                  const isRoot = n.id === rootId;
                  const radius = (isRoot ? 5 : 3) + Math.sqrt(n.inDegree) * 2.2;
                  return (
                    <g
                      key={n.id}
                      onClick={() => setSelectedId((cur) => (cur === n.id ? null : n.id))}
                      onMouseEnter={() => setHoveredId(n.id)}
                      onMouseLeave={() => setHoveredId((cur) => (cur === n.id ? null : cur))}
                      style={{ cursor: "pointer" }}
                    >
                      {isRoot && (
                        <circle cx={n.x} cy={n.y} r={radius + 4} fill="none" stroke={STATUS.info} strokeWidth={1.5} strokeDasharray="2 2" />
                      )}
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={radius}
                        fill={n.statusColor}
                        fillOpacity={isDimmed ? 0.15 : 0.9}
                        stroke={isSelected ? STATUS.info : isDark ? "#0f172a" : "#ffffff"}
                        strokeWidth={isSelected ? 2.5 : 1}
                      >
                        <title>{`${n.id}\n${n.inDegree} inbound / ${n.outDegree} outbound internal link${n.inDegree + n.outDegree === 1 ? "" : "s"}`}</title>
                      </circle>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
        </div>

        {selectedId && (
          <NodeDetailPanel
            url={selectedId}
            details={selectedDetails}
            inDegree={inDegreeById.get(selectedId) || 0}
            outDegree={outDegreeById.get(selectedId) || 0}
            isRoot={selectedId === rootId}
            onClose={() => setSelectedId(null)}
            onCopy={() => copyUrl(selectedId)}
            onOpen={() => openBrowserWindow(selectedId)}
          />
        )}
      </div>
    </div>
  );
}

function NodeDetailPanel({ url, details, inDegree, outDegree, isRoot, onClose, onCopy, onOpen }) {
  const statusCode = details?.status_code;
  const title = details?.title?.[0]?.title || "(no title)";
  const indexable = (details?.indexability?.indexability ?? 0) >= 0.5;
  const reason = details?.indexability?.indexability_reason;
  const linkScore = details?.link_score;

  return (
    <div className="w-[220px] shrink-0 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 overflow-y-auto flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isRoot && <Home className="w-3 h-3 text-sky-500 shrink-0" />}
          <p className="text-[11px] font-bold text-slate-800 dark:text-slate-100 leading-tight line-clamp-2">
            {title}
          </p>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="text-[9px] font-mono text-slate-500 dark:text-slate-400 break-all leading-tight">{url}</p>

      <div className="flex items-center gap-1.5">
        <button
          onClick={onOpen}
          className="flex items-center gap-1 text-[9px] font-semibold px-2 py-1 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 transition-colors"
        >
          <ExternalLink className="w-3 h-3" /> باز کردن
        </button>
        <button
          onClick={onCopy}
          className="flex items-center gap-1 text-[9px] font-semibold px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        >
          <Copy className="w-3 h-3" /> کپی
        </button>
      </div>

      <div className="border-t border-slate-100 dark:border-slate-800 pt-2 space-y-1.5">
        <DetailRow label="Status Code" value={statusCode ?? "—"} valueColor={statusColorFor(statusCode)} />
        <DetailRow
          label="قابلیت ایندکس"
          value={indexable ? "Indexable" : "Not Indexable"}
          valueColor={indexable ? STATUS.good : STATUS.critical}
        />
        {!indexable && reason && (
          <p className="text-[9px] text-slate-400 italic leading-tight">{reason}</p>
        )}
        <DetailRow label="عمق کراول" value={details?.url_depth ?? "—"} />
        <DetailRow label="تعداد کلمات" value={details?.word_count ?? "—"} />
        {linkScore !== undefined && linkScore !== null && (
          <DetailRow label="امتیاز لینک" value={linkScore} />
        )}
        <DetailRow label="لینک‌های ورودی" value={inDegree} valueColor={STATUS.info} />
        <DetailRow label="لینک‌های خروجی" value={outDegree} valueColor={STATUS.serious} />
        <DetailRow label="HTTPS" value={details?.https ? "Yes" : "No"} />
      </div>
    </div>
  );
}

function DetailRow({ label, value, valueColor }) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-bold" style={{ color: valueColor }}>
        {value}
      </span>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
