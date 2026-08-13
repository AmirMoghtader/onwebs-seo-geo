// @ts-nocheck
"use client";

// Screaming Frog's Internal tab: every internal URL in one virtualised table
// with the full 73-column set, a content-type filter, per-column sorting and a
// column picker. Only a subset is visible by default — showing all 73 at once
// would be unreadable — but every one is available and every one exports.

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  memo,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import debounce from "lodash/debounce";
import { Upload, Columns3 } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { INTERNAL_FILTERS } from "./tableLayout";
import {
  INTERNAL_COLUMNS,
  headerTitles,
  getRowValues,
  DEFAULT_VISIBLE,
} from "./columns";
import { useTableSort, sortIndicator } from "../components/useTableSort";
import { displayAddress } from "@/app/lib/urlDisplay";
import useGlobalCrawlStore, { useDataActions } from "@/store/GlobalCrawlDataStore";

const STORAGE_KEY = "onwebs.internal.visibleColumns";

const STATUS_CODE_COLUMN = INTERNAL_COLUMNS.findIndex(
  (c) => c.header === "Status Code",
);

/**
 * Canonical form for cross-panel URL matching. The sitemap panel publishes
 * addresses read out of a sitemap file while this table's come from the crawl,
 * and the two disagree on scheme, www, trailing slash and percent-encoding
 * often enough that a raw string compare drops real matches.
 */
function normalizeUrl(u: string): string {
  if (!u) return "";
  try {
    let s = decodeURI(String(u).trim().toLowerCase());
    s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
    s = s.split("#")[0];
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return String(u).trim().toLowerCase();
  }
}

const TableHeader = memo(({ visible, onSort, sort }: any) => (
  <div
    className="domainCrawl border-b bg-white dark:bg-brand-darker sticky top-0 z-10"
    style={{
      display: "grid",
      gridTemplateColumns: visible.map((v: any) => v.width).join(" "),
      height: "30px",
      alignItems: "center",
      fontSize: "12px",
      width: "max-content",
      minWidth: "100%",
    }}
  >
    {visible.map((v: any) => (
      <div
        key={v.index}
        onClick={() => onSort(v.index)}
        title={`${v.header} — کلیک: مرتب‌سازی (نزولی → صعودی → بدون مرتب‌سازی)`}
        style={{
          padding: "8px",
          userSelect: "none",
          justifyContent:
            v.align === "center"
              ? "center"
              : v.align === "right"
                ? "flex-end"
                : "flex-start",
          height: "30px",
          display: "flex",
          alignItems: "center",
          fontWeight: "bold",
          overflow: "hidden",
          whiteSpace: "nowrap",
          // The header sorts in place; a pointer cursor would suggest it
          // navigates somewhere, so the arrow is left alone.
          cursor: "default",
        }}
        className="dark:text-white/50 dark:bg-brand-darker text-black/50 dark:border-brand-dark bg-white shadow dark:border hover:text-brand-bright dark:hover:text-brand-bright"
      >
        <span className="truncate">{v.header}</span>
        <span
          style={{
            marginInlineStart: 4,
            fontSize: 10,
            color: "var(--brand-bright, #2B6CC4)",
          }}
        >
          {sortIndicator(sort, v.index)}
        </span>
      </div>
    ))}
  </div>
));
TableHeader.displayName = "InternalTableHeader";

const TableRow = memo(
  ({ row, index, all, visible, isSelected, isPicked, onRowClick, onRowContextMenu }: any) => {
    const rowData = useMemo(
      () => getRowValues(row, index, all),
      [row, index, all],
    );

    return (
      <div
        onClick={(e: any) => onRowClick(index, e)}
        onContextMenu={(e: any) => onRowContextMenu(index, e)}
        style={{
          display: "grid",
          gridTemplateColumns: visible.map((v: any) => v.width).join(" "),
          height: "100%",
          alignItems: "center",
          color: isSelected ? "white" : "inherit",
          width: "max-content",
          minWidth: "100%",
        }}
        className={`text-xs cursor-pointer ${
          isSelected
            ? "bg-brand-bright"
            : isPicked
              ? "bg-brand-bright/20"
              : "hover:bg-gray-100 dark:hover:bg-brand-dark/40"
        }`}
      >
        {visible.map((v: any) => {
          const cell = rowData[v.index];
          return (
            <div
              key={v.index}
              style={{
                padding: "0 8px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textAlign: v.align,
              }}
              title={String(cell ?? "")}
            >
              {cell}
            </div>
          );
        })}
      </div>
    );
  },
);
TableRow.displayName = "InternalTableRow";

const InternalTable = ({ rows = [], rowHeight = 26, overscan = 12 }: any) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterKey, setFilterKey] = useState("all");
  const [clickedRow, setClickedRow] = useState<number | null>(null);
  // Addresses currently selected, by the same rules a file list uses: click,
  // Cmd-click, Shift-click. Selection is available everywhere, not only in the
  // failure view — what the right-click menu will *do* with it is what varies.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState(false);
  /** Where the right-click menu is anchored, or null when it is closed. */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const { selectURL, setSelectedTableURL, setInlinks, setOutlinks } =
    useDataActions();

  // The right-hand panels drive this table instead of listing rows themselves:
  // the overview tiles and tree publish a rule (`tableFilter`), the sitemap
  // buckets publish the exact URLs they found (`tableUrlFilter`).
  const tableFilter = useGlobalCrawlStore((st) => st.tableFilter);
  const tableUrlFilter = useGlobalCrawlStore((st) => st.tableUrlFilter);
  const setTableFilter = useGlobalCrawlStore(
    (st) => st.actions.ui.setTableFilter,
  );

  // The Overview tree publishes "<tab>:<filter>", and the Internal element's
  // filter keys are the very ones this dropdown uses, so adopt them verbatim.
  useEffect(() => {
    const kind = tableFilter?.kind || "";
    if (!kind.startsWith("internal:")) return;
    const wanted = kind.slice("internal:".length);
    if (INTERNAL_FILTERS.some((f) => f.key === wanted)) setFilterKey(wanted);
  }, [tableFilter]);

  const [columnVisibility, setColumnVisibility] =
    useState<boolean[]>(DEFAULT_VISIBLE);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (Array.isArray(saved) && saved.length === INTERNAL_COLUMNS.length) {
        setColumnVisibility(saved);
      }
    } catch {
      /* fall back to the default set */
    }
  }, []);

  const setVisibility = useCallback((next: boolean[]) => {
    setColumnVisibility(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* the choice just won't survive a restart */
    }
  }, []);

  const visible = useMemo(
    () =>
      INTERNAL_COLUMNS.map((c, i) => ({ ...c, index: i })).filter(
        (c) => columnVisibility[c.index],
      ),
    [columnVisibility],
  );

  // Assets are discovered by reading page HTML, never requested, so their
  // Status Code and Size arrive empty. Fetch them once per crawl in the
  // background and merge the answers in.
  const [assetStatus, setAssetStatus] = useState<Record<string, any>>({});
  const checkedRef = useRef<string>("");

  useEffect(() => {
    const pending = (rows || [])
      .filter((r: any) => !String(r.contentType || "").includes("html"))
      .filter((r: any) => r.statusCode === "" || r.statusCode === undefined)
      .map((r: any) => r.address);
    if (!pending.length) return;

    const signature = `${pending.length}:${pending[0]}`;
    if (checkedRef.current === signature) return;
    checkedRef.current = signature;

    let cancelled = false;
    (async () => {
      try {
        const results: any[] = await invoke("check_assets_command", {
          urls: pending.slice(0, 500),
        });
        if (cancelled || !Array.isArray(results)) return;
        const map: Record<string, any> = {};
        for (const r of results) map[r.url] = r;
        setAssetStatus((prev) => ({ ...prev, ...map }));
      } catch (e) {
        // A failed sweep must not break the table; those columns stay blank.
        console.error("Asset check failed:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rows]);

  const enrichedRows = useMemo(() => {
    if (!Object.keys(assetStatus).length) return rows || [];
    return (rows || []).map((r: any) => {
      const hit = assetStatus[r.address];
      if (!hit) return r;
      return {
        ...r,
        statusCode: hit.status || r.statusCode,
        contentType: hit.content_type || r.contentType,
        sizeBytes: hit.size_bytes ?? r.sizeBytes,
        transferredBytes: hit.size_bytes ?? r.transferredBytes,
        // Once an asset has actually been fetched it has a real status, so it
        // gets the same Indexable/timestamp treatment a page does.
        indexability:
          r.indexability ||
          (Number(hit.status) > 0 && Number(hit.status) < 400 ? "Indexable" : ""),
        crawlTimestamp: r.crawlTimestamp || hit.checked_at || "",
        lastModified: r.lastModified || hit.last_modified || "",
      };
    });
  }, [rows, assetStatus]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const f of INTERNAL_FILTERS)
      out[f.key] = enrichedRows.filter(f.match).length;
    return out;
  }, [enrichedRows]);

  // Whichever overview tile is active, as a predicate. Null when the published
  // filter names something this table cannot re-derive (an issue, a sitemap
  // bucket) — those arrive as an explicit URL set instead.
  const tilePredicate = useMemo(() => {
    const code = (r: any) => Number(r?.statusCode) || 0;
    switch (tableFilter?.kind) {
      case "3xx":
        return (r: any) => code(r) >= 300 && code(r) < 400;
      case "4xx":
        return (r: any) => code(r) >= 400 && code(r) < 500;
      case "5xx":
        return (r: any) => code(r) >= 500;
      case "nonIndexable":
        return (r: any) => r?.indexability === "Non-Indexable";
      // A real failure is status 0 *and* a reason. `crawl_error` alone is far
      // too broad: a redirect whose target was already handled carries a note
      // in the same field, which on one websima.com crawl was 278 perfectly
      // healthy 301s against 10 genuine failures. Status alone is no good
      // either, since assets have no status yet and read as 0.
      case "failed":
        return (r: any) =>
          Number(r?.statusCode) === 0 && Boolean(r?.crawlError);
      default:
        return null;
    }
  }, [tableFilter]);

  const urlFilterSet = useMemo(
    () => (tableUrlFilter ? new Set(tableUrlFilter.map(normalizeUrl)) : null),
    [tableUrlFilter],
  );

  const filteredRows = useMemo(() => {
    const def = INTERNAL_FILTERS.find((f) => f.key === filterKey);
    let out = def ? enrichedRows.filter(def.match) : enrichedRows;
    if (tilePredicate) out = out.filter(tilePredicate);
    if (urlFilterSet) {
      out = out.filter((r: any) => urlFilterSet.has(normalizeUrl(r.address)));
    }
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      // Both forms of the address are searchable: the column shows the readable
      // one, so typing `سئو` has to match, but a URL pasted from the browser
      // arrives percent-encoded and has to match too.
      out = out.filter((r: any) =>
        `${r.address} ${displayAddress(r.address)} ${r.title} ${r.contentType}`
          .toLowerCase()
          .includes(term),
      );
    }
    return out;
  }, [enrichedRows, filterKey, searchTerm, tilePredicate, urlFilterSet]);

  // "% of Total" is relative to the whole set, so the accessor closes over it.
  const accessor = useCallback(
    (row: any, index: number) => getRowValues(row, index, filteredRows),
    [filteredRows],
  );

  const { sortedRows, sort, toggleSort, setSort } = useTableSort(
    filteredRows,
    accessor,
  );

  // Narrowing to 4XX is only half the answer — the codes have to lead, or the
  // user still has to hunt for them. Clicking a status tile orders the table
  // by Status Code the way clicking the header would.
  useEffect(() => {
    if (!tableFilter || STATUS_CODE_COLUMN < 0) return;
    if (["3xx", "4xx", "5xx"].includes(tableFilter.kind)) {
      setSort({ column: STATUS_CODE_COLUMN, direction: "desc" });
    }
  }, [tableFilter, setSort]);

  // Panels publish a filter and a tab jump together; a filter that outlives the
  // panel selection would leave rows hidden with no way back, so the banner
  // below is the single place both are dropped.
  const activeFilterLabel =
    tilePredicate || urlFilterSet ? tableFilter?.label || "انتخاب‌شده" : null;

  const clearFilter = useCallback(() => {
    setTableFilter(null);
    setFilterKey("all");
  }, [setTableFilter]);

  // Where a Shift-range measures from: the last row clicked without Shift.
  const anchorRef = useRef<number | null>(null);
  const sortedRowsRef = useRef<any[]>([]);
  sortedRowsRef.current = sortedRows;

  // Selection follows the platform convention rather than inventing one:
  // a plain click replaces the selection, Cmd (or Ctrl) adds and removes one
  // row, and Shift takes the run between the anchor and the row clicked.
  const applySelection = useCallback((index: number, event: any) => {
    const rows = sortedRowsRef.current;
    const address = rows[index]?.address;
    if (!address) return;

    const additive = event?.metaKey || event?.ctrlKey;
    const ranged = event?.shiftKey;

    setPicked((current) => {
      if (ranged && anchorRef.current !== null) {
        const [from, to] = [anchorRef.current, index].sort((a, b) => a - b);
        const run = rows
          .slice(from, to + 1)
          .map((r: any) => r?.address)
          .filter(Boolean);
        // Shift extends what is already there, the way a file list does.
        return new Set(additive ? [...current, ...run] : run);
      }

      if (additive) {
        const next = new Set(current);
        next.has(address) ? next.delete(address) : next.add(address);
        anchorRef.current = index;
        return next;
      }

      anchorRef.current = index;
      return new Set([address]);
    });
  }, []);

  const onRowContextMenu = useCallback(
    (rowIndex: number, event: any) => {
      event.preventDefault();
      const address = sortedRowsRef.current[rowIndex]?.address;
      if (!address) return;
      // Right-clicking inside an existing selection acts on the whole of it;
      // right-clicking outside makes that row the selection first.
      setPicked((current) =>
        current.has(address) ? current : new Set([address]),
      );
      anchorRef.current = rowIndex;
      setMenuAt({ x: event.clientX, y: event.clientY });
    },
    [],
  );

  // Only rows that never produced a response are worth re-requesting. A page
  // that answered 404 answered; asking again just crawls it a second time.
  const retryableUrls = useMemo(
    () =>
      sortedRowsRef.current
        .filter(
          (r: any) =>
            picked.has(r?.address) &&
            Number(r?.statusCode) === 0 &&
            Boolean(r?.crawlError),
        )
        .map((r: any) => r.address),
    [picked],
  );
  const retryableCount = retryableUrls.length;

  const retryPicked = useCallback(async () => {
    if (retryableUrls.length === 0) return;
    setRetrying(true);
    try {
      await invoke("retry_urls_command", { urls: retryableUrls });
      toast.success(`${retryableUrls.length} نشانی دوباره تلاش شد`);
      setPicked(new Set());
    } catch (error) {
      toast.error(`تلاش مجدد ناموفق بود: ${error}`);
    } finally {
      setRetrying(false);
    }
  }, [retryableUrls]);

  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  const debouncedSearch = useMemo(
    () => debounce((v: string) => setSearchTerm(v), 300),
    [],
  );

  // Exports every column, not just the visible ones, so the file matches
  // Screaming Frog's export regardless of what is on screen.
  const exportCSV = async () => {
    try {
      const esc = (v: any) => {
        const t = String(v ?? "");
        return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
      };
      const lines = [headerTitles.map(esc).join(",")];
      sortedRows.forEach((r, i) => {
        lines.push(getRowValues(r, i, sortedRows).map(esc).join(","));
      });
      const path = await save({
        defaultPath: `Onwebs-Internal-${filterKey}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      await writeFile(path, new TextEncoder().encode("﻿" + lines.join("\n")));
      toast.success(`${sortedRows.length} ردیف در CSV ذخیره شد`);
    } catch (e) {
      console.error(e);
      toast.error("خروجی گرفتن ناموفق بود");
    }
  };

  const onRowClick = useCallback(
    (rowIndex: number, event?: any) => {
      applySelection(rowIndex, event);

      // A modified click is selecting, not navigating: opening the details
      // pane for the last row of a Cmd-click run would fight the selection.
      if (event?.metaKey || event?.ctrlKey || event?.shiftKey) return;

      setClickedRow((prev) => (prev === rowIndex ? null : rowIndex));
      const row = sortedRowsRef.current[rowIndex];
      if (!row?.address) return;

      // Only HTML pages exist in the crawl database. Assets were seen as
      // references inside a page, so asking the backend for one returns
      // nothing — publish the row we already have instead of a blank pane.
      if (String(row.contentType || "").includes("html")) {
        selectURL(row.address);
        return;
      }

      setSelectedTableURL([
        {
          url: row.address,
          content_type: row.contentType,
          status_code: typeof row.statusCode === "number" ? row.statusCode : 0,
          page_size: row.sizeBytes ? [{ bytes: row.sizeBytes }] : [],
          title: row.title
            ? [{ title: row.title, title_len: row.title.length }]
            : [],
          description: "",
          headings: {},
          word_count: 0,
          found_at: row.foundAt,
          is_asset: true,
        },
      ]);
      setInlinks([]);
      setOutlinks([]);
    },
    [selectURL, setSelectedTableURL, setInlinks, setOutlinks],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b dark:border-brand-dark shrink-0">
        <select
          value={filterKey}
          onChange={(e) => setFilterKey(e.target.value)}
          className="text-xs border rounded px-2 py-1 bg-white dark:bg-brand-darker dark:border-brand-dark"
          style={{ direction: "ltr", textAlign: "left" }}
        >
          {INTERNAL_FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label} ({counts[f.key] ?? 0})
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="جستجو..."
          onChange={(e) => debouncedSearch(e.target.value)}
          className="flex-1 text-xs border rounded px-2 py-1 bg-white dark:bg-brand-darker dark:border-brand-dark"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              title="انتخاب ستون‌ها"
              className="flex items-center gap-1 text-xs border rounded px-2 py-1 dark:border-brand-dark hover:border-brand-bright hover:text-brand-bright whitespace-nowrap"
            >
              <Columns3 className="w-3 h-3" />
              ستون‌ها ({visible.length}/{INTERNAL_COLUMNS.length})
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="max-h-[420px] overflow-y-auto z-[99999999]"
            align="end"
          >
            {INTERNAL_COLUMNS.map((c, i) => (
              <DropdownMenuCheckboxItem
                key={c.header}
                checked={columnVisibility[i]}
                disabled={c.supported === false}
                onCheckedChange={(checked) => {
                  const next = [...columnVisibility];
                  next[i] = Boolean(checked);
                  setVisibility(next);
                }}
                onSelect={(e) => e.preventDefault()}
              >
                <span className={c.supported === false ? "opacity-40" : ""}>
                  {c.header}
                  {c.supported === false && " — جمع‌آوری نمی‌شود"}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          onClick={exportCSV}
          className="flex items-center gap-1 text-xs border rounded px-2 py-1 dark:border-brand-dark hover:border-brand-bright hover:text-brand-bright"
        >
          <Upload className="w-3 h-3" />
          Export
        </button>

        <span className="text-[11px] text-gray-500 dark:text-white/40 font-mono whitespace-nowrap">
          Filter Total: {sortedRows.length}
        </span>
      </div>

      {/* A table showing 3 of 228 rows just looks broken unless the filter that
          did it is on screen and undoable. */}
      {activeFilterLabel && (
        <div className="flex items-center gap-2 px-3 py-1 text-[11px] bg-brand-bright/10 border-b border-brand-bright/30 shrink-0">
          <span className="font-bold text-brand-bright">
            فیلتر فعال: {activeFilterLabel}
          </span>
          <span className="font-mono text-gray-500 dark:text-white/40">
            {sortedRows.length} از {enrichedRows.length}
          </span>
          <button
            onClick={clearFilter}
            className="ml-auto px-2 py-0.5 rounded border border-brand-bright/40 text-brand-bright hover:bg-brand-bright hover:text-white transition-colors"
          >
            حذف فیلتر ✕
          </button>
        </div>
      )}

      <div ref={parentRef} className="flex-1 min-h-0 overflow-auto">
        <TableHeader visible={visible} onSort={toggleSort} sort={sort} />

        {sortedRows.length > 0 ? (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "max-content",
              minWidth: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <TableRow
                  row={sortedRows[virtualRow.index]}
                  index={virtualRow.index}
                  all={sortedRows}
                  visible={visible}
                  isSelected={clickedRow === virtualRow.index}
                  isPicked={picked.has(sortedRows[virtualRow.index]?.address)}
                  onRowClick={onRowClick}
                  onRowContextMenu={onRowContextMenu}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-xs text-gray-500">
            داده‌ای موجود نیست.
          </div>
        )}
      </div>

      {/* Right-click menu. Rendered at the cursor rather than wrapping every
          row in a trigger, so the virtualiser keeps recycling plain divs. */}
      {menuAt && (
        <>
          <div
            className="fixed inset-0 z-[100000]"
            onClick={() => setMenuAt(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuAt(null);
            }}
          />
          <div
            className="fixed z-[100001] min-w-[200px] rounded-md border bg-popover text-popover-foreground shadow-md py-1 text-xs"
            style={{ top: menuAt.y, left: menuAt.x }}
          >
            <div className="px-3 py-1 text-[10px] text-gray-500 dark:text-white/40">
              {picked.size} نشانی انتخاب‌شده
            </div>
            <button
              onClick={() => {
                setMenuAt(null);
                retryPicked();
              }}
              disabled={retryableCount === 0 || retrying}
              title={
                retryableCount === 0
                  ? "فقط نشانی‌هایی که کراول نشدند دوباره تلاش می‌شوند"
                  : "این نشانی‌ها را دوباره درخواست کن"
              }
              className="w-full text-left px-3 py-1.5 hover:bg-brand-bright hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit disabled:cursor-not-allowed transition-colors"
            >
              تلاش مجدد
              {retryableCount > 0 ? ` (${retryableCount})` : ""}
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(Array.from(picked).join("\n"));
                toast.success(`${picked.size} نشانی کپی شد`);
                setMenuAt(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-brand-bright hover:text-white transition-colors"
            >
              کپی نشانی‌ها
            </button>
            <button
              onClick={() => {
                setPicked(new Set());
                setMenuAt(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-brand-bright hover:text-white transition-colors"
            >
              لغو انتخاب
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default memo(InternalTable);
