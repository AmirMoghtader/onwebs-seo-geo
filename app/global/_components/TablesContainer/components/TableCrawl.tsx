// @ts-nocheck
"use client";

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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import {
  initialColumnWidths,
  initialColumnAlignments,
  headerTitles,
  getRowValues,
} from "./tableLayout";
import { useTableSort, sortIndicator, type SortState } from "./useTableSort";
import { ISSUE_REGISTRY } from "@/app/global/_components/Sidebar/Issues/libs/issuesRegistry";
import { TbColumns3 } from "react-icons/tb";
import DownloadButton from "./DownloadButton";
import useGlobalCrawlStore, {
  useDataActions,
  useIsGeneratingExcel,
} from "@/store/GlobalCrawlDataStore";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { exportSEODataCSV } from "./generateCSV";
import ContextTableMenu from "./ContextTableMenu";
import LinkContextMenu from "./LinkContextMenu";

const URL_COLUMN_INDEX = 1;

interface TableCrawlProps {
  rows: Array<{
    url?: string;
    title?: Array<{ title?: string; title_len?: string }>;
    headings?: { h1?: string[]; h2?: string[] };
    status_code?: number;
    word_count?: number;
    mobile?: boolean;
    meta_robots?: { meta_robots: string[] };
    cookies?: { Ok?: string[] } | string[];
  }>;
  rowHeight?: number;
  overscan?: number;
  tabName?: string;
}

interface TruncatedCellProps {
  text: string;
  maxLength?: number;
  width?: string;
}

interface ResizableDividerProps {
  onMouseDown: (e: React.MouseEvent) => void;
}

interface TableHeaderProps {
  headers: string[];
  columnWidths: string[];
  columnAlignments: string[];
  onResize: (index: number, e: React.MouseEvent) => void;
  onAlignToggle: (index: number) => void;
  onSort: (index: number) => void;
  sort: SortState;
  columnVisibility: boolean[];
}

interface TableRowProps {
  row: TableCrawlProps["rows"][number];
  index: number;
  columnWidths: string[];
  columnAlignments: string[];
  columnVisibility: boolean[];
  isSelected: boolean;
  handleCellClick: (
    rowIndex: number,
    cellIndex: number,
    cellContent: string,
    row: any,
  ) => void;
  onCellDoubleClick: (content: string) => void;
}

interface ColumnPickerProps {
  columnVisibility: boolean[];
  setColumnVisibility: (visibility: any) => void;
  headerTitles: string[];
}

const TruncatedCell = memo(
  ({ text, maxLength = 90, width = "auto" }: TruncatedCellProps) => {
    const truncatedText = useMemo(() => {
      if (!text) return "";
      return text.toString().length > maxLength
        ? `${text.toString().slice(0, maxLength)}...`
        : text;
    }, [text, maxLength]);

    return (
      <div
        style={{
          width,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {truncatedText}
      </div>
    );
  },
);

TruncatedCell.displayName = "TruncatedCell";

const ResizableDivider = memo(({ onMouseDown }: ResizableDividerProps) => {
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: "5px",
        cursor: "col-resize",
        zIndex: 1,
      }}
    />
  );
});

ResizableDivider.displayName = "ResizableDivider";

const TableHeader = memo(
  ({
    headers,
    columnWidths,
    columnAlignments,
    onResize,
    onAlignToggle,
    onSort,
    sort,
    columnVisibility,
  }: TableHeaderProps) => {
    const visibleItems = useMemo(() => {
      return headers
        .map((header, index) => ({
          header,
          width: columnWidths[index],
          alignment: columnAlignments[index],
          visible: columnVisibility[index],
          originalIndex: index,
        }))
        .filter((item) => item.visible);
    }, [headers, columnWidths, columnAlignments, columnVisibility]);

    return (
      <div
        className="domainCrawl border-b bg-white dark:bg-brand-darker"
        style={{
          display: "grid",
          gridTemplateColumns: visibleItems.map((item) => item.width).join(" "),
          height: "30px",
          alignItems: "center",
          fontSize: "12px",
          width: "100%",
        }}
      >
        {visibleItems.map((item) => (
          <div
            key={item.header}
            style={{
              position: "relative",
              padding: "8px",
              userSelect: "none",
              justifyContent:
                item.alignment === "center"
                  ? "center"
                  : item.alignment === "right"
                    ? "flex-end"
                    : "flex-start",
              height: "30px",
              display: "flex",
              alignItems: "center",
              fontWeight: "bold",
              cursor: "pointer",
            }}
            onClick={() => onSort(item.originalIndex)}
            onDoubleClick={(e) => {
              // Alignment used to own the single click; sorting needs it, so
              // alignment moved to double-click.
              e.stopPropagation();
              onAlignToggle(item.originalIndex);
            }}
            title="کلیک: مرتب‌سازی (نزولی → صعودی → بدون مرتب‌سازی) — دوبار کلیک: تغییر چیدمان ستون"
            className="dark:text-white/50 dark:bg-brand-darker text-black/50 dark:border-brand-dark  bg-white shadow dark:border hover:text-brand-bright dark:hover:text-brand-bright"
          >
            {item.header}
            <span
              style={{
                marginInlineStart: 4,
                fontSize: 10,
                color: "var(--brand-bright, #2B6CC4)",
              }}
            >
              {sortIndicator(sort, item.originalIndex)}
            </span>
            <ResizableDivider
              onMouseDown={(e) => onResize(item.originalIndex, e)}
            />
          </div>
        ))}
      </div>
    );
  },
);

TableHeader.displayName = "TableHeader";

const TableRow = memo(
  ({
    row,
    index,
    columnWidths,
    columnAlignments,
    columnVisibility,
    isSelected,
    handleCellClick,
    onCellDoubleClick,
  }: TableRowProps) => {
    // Shared with the sort comparator via tableLayout.getRowValues so the
    // values sorted on are always the values rendered.
    const rowData = useMemo(() => getRowValues(row, index), [row, index]);

    const visibleItems = useMemo(() => {
      return rowData
        .map((cell, i) => ({
          cell,
          width: columnWidths[i],
          alignment: columnAlignments[i],
          visible: columnVisibility[i],
          originalIndex: i,
        }))
        .filter((item) => item.visible);
    }, [rowData, columnWidths, columnAlignments, columnVisibility]);

    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: visibleItems.map((item) => item.width).join(" "),
          height: "100%",
          alignItems: "center",
          color: isSelected ? "white" : "inherit",
        }}
        className="dark:text-white/50 cursor-pointer not-selectable hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
      >
        {visibleItems.map((item, visibleIdx) => (
          <div
            key={`cell-${index}-${item.originalIndex}`}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onCellDoubleClick(item.cell?.toString() || "");
            }}
            onClick={() =>
              handleCellClick(
                index,
                item.originalIndex,
                item.cell?.toString?.() || "",
                row,
              )
            }
            style={{
              padding: "6px 8px",
              justifyContent:
                item.alignment === "center"
                  ? "center"
                  : item.alignment === "right"
                    ? "flex-end"
                    : "flex-start",
              overflow: "hidden",
              whiteSpace: "nowrap",
              height: "100%",
              display: "flex",
              alignItems: "center",
            }}
            className={`dark:text-white text-xs dark:border dark:border-brand-dark border ${
              isSelected
                ? "bg-blue-600"
                : index % 2 === 0
                  ? "bg-white dark:bg-brand-darker"
                  : "bg-gray-50 dark:bg-brand-dark/30"
            }`}
          >
            {item.originalIndex === URL_COLUMN_INDEX ? (
              <LinkContextMenu
                url={row?.url}
                role="source"
                forceWhiteText={isSelected}
              >
                <TruncatedCell text={item.cell?.toString()} width="100%" />
              </LinkContextMenu>
            ) : (
              <ContextTableMenu data={item.cell}>
                <TruncatedCell text={item.cell?.toString()} width="100%" />
              </ContextTableMenu>
            )}
          </div>
        ))}
      </div>
    );
  },
);

TableRow.displayName = "TableRow";

const ColumnPicker = memo(
  ({
    columnVisibility,
    setColumnVisibility,
    headerTitles,
  }: ColumnPickerProps) => {
    const handleToggle = useCallback(
      (index: number) => {
        setColumnVisibility((prev: boolean[]) => {
          const newVisibility = [...prev];
          newVisibility[index] = !newVisibility[index];
          return newVisibility;
        });
      },
      [setColumnVisibility],
    );

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div className="border dark:border-white/20 w-8 flex justify-center items-center rounded h-6 cursor-pointer hover:bg-gray-100 dark:hover:bg-brand-dark">
            <TbColumns3 className="w-5 h-5 dark:text-white/50 p-1" />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-32 bg-white dark:bg-brand-darker border dark:border-brand-dark rounded shadow-lg z-20">
          {headerTitles.map((header, index) => (
            <DropdownMenuCheckboxItem
              key={header}
              checked={columnVisibility[index] ?? true}
              onCheckedChange={() => handleToggle(index)}
              className="p-2 hover:bg-gray-100 w-full dark:hover:bg-brand-dark space-x-6 dark:text-white text-brand-bright"
            >
              <span className="ml-5 dark:text-brand-bright">{header}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
);

ColumnPicker.displayName = "ColumnPicker";

const TableCrawl = ({
  tabName,
  rows,
  rowHeight = 25,
  overscan = 10,
}: TableCrawlProps) => {
  const [columnWidths, setColumnWidths] = useState(initialColumnWidths);
  const [columnAlignments, setColumnAlignments] = useState(
    initialColumnAlignments,
  );
  const [isResizing, setIsResizing] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [columnVisibility, setColumnVisibility] = useState(() =>
    headerTitles.map(() => true),
  );

  // Use granular selectors to avoid unnecessary re-renders
  const isGeneratingExcel = useIsGeneratingExcel();
  const setIsGeneratingExcel = useGlobalCrawlStore(
    (s) => s.setIsGeneratingExcel,
  );

  const { setInlinks, setOutlinks, setSelectedTableURL, selectURL } =
    useDataActions();

  // Set by the overview tiles (3XX / 4XX / 5XX / non-indexable).
  const tableFilter = useGlobalCrawlStore((st) => st.tableFilter);
  const setTableFilter = useGlobalCrawlStore(
    (st) => st.actions.ui.setTableFilter,
  );

  const handleDownload = useCallback(async () => {
    const totalUrlsCrawled = useGlobalCrawlStore.getState().totalUrlsCrawled;
    if (!rows.length && totalUrlsCrawled === 0) {
      toast.error("داده‌ای برای دانلود وجود ندارد");
      return;
    }

    //NOTE: Here sets the exporting state threshold to switch to excel and backend export.
    if (totalUrlsCrawled > 0) {
      toast.info("در حال خروجی گرفتن از دیتابیس...");
      setIsGeneratingExcel(true);
      try {
        const fileBuffer = await invoke("export_full_crawl_to_excel_command", {
          visibleColumns: columnVisibility,
        });

        setIsGeneratingExcel(false);
        const filePath = await save({
          filters: [
            {
              name: "Excel File",
              extensions: ["xlsx"],
            },
          ],
          defaultPath: `Onwebs SEO & GEO-DeepCrawl-Export.xlsx`,
        });

        if (filePath) {
          await writeFile(filePath, new Uint8Array(fileBuffer as any));
          toast.success("خروجی Excel از دیتابیس کامل شد!");
        }
      } catch (error) {
        console.error("Error generating massive Excel export:", error);
        setIsGeneratingExcel(false);
      }
    } else {
      if (rows.length > 0) {
        toast.info("داده‌های شما در حال آماده‌سازی است...");
        await exportSEODataCSV(rows, columnVisibility);
      } else {
        setIsGeneratingExcel(true);
        try {
          const fileBuffer = await invoke("create_excel_main_table", {
            data: rows,
            visibleColumns: columnVisibility,
          });

          setIsGeneratingExcel(false);
          const filePath = await save({
            filters: [
              {
                name: "Excel File",
                extensions: ["xlsx"],
              },
            ],
            defaultPath: `Onwebs SEO & GEO-${tabName}.xlsx`,
          });

          if (filePath) {
            await writeFile(filePath, new Uint8Array(fileBuffer as any));
            toast.success("فایل Excel با موفقیت ذخیره شد!");
          }
        } catch (error) {
          console.error("Error generating or saving Excel file:", error);
          setIsGeneratingExcel(false);
        }
      }
    }
  }, [rows, tabName, setIsGeneratingExcel, columnVisibility]);

  const [clickedCell, setClickedCell] = useState<{
    row: number | null;
    cell: number | null;
  }>({
    row: null,
    cell: null,
  });

  const handleCellClick = useCallback(
    (rowIndex: number, cellIndex: number, cellContent: string, row: any) => {
      setClickedCell((prevClickedCell) => {
        if (prevClickedCell.row === rowIndex) {
          return { row: null, cell: null };
        } else {
          return { row: rowIndex, cell: cellIndex };
        }
      });

      if (row?.url) {
        selectURL(row.url);
      }
    },
    [selectURL],
  );

  const handleCellDoubleClick = useCallback((content: string) => {
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      toast.success("سلول در کلیپ‌بورد کپی شد", {
        description:
          content.length > 50 ? `${content.slice(0, 50)}...` : content,
        position: "bottom-right",
      });
    });
  }, []);

  const startXRef = useRef(0);
  const parentRef = useRef<HTMLDivElement>(null);

  // Predicate for whichever overview tile the user clicked. Null when no tile
  // is active, in which case the table shows everything as before.
  const tilePredicate = useMemo(() => {
    switch (tableFilter?.kind) {
      case "3xx":
        return (r: any) => (r?.status_code || 0) >= 300 && (r?.status_code || 0) < 400;
      case "4xx":
        return (r: any) => (r?.status_code || 0) >= 400 && (r?.status_code || 0) < 500;
      case "5xx":
        return (r: any) => (r?.status_code || 0) >= 500;
      case "nonIndexable":
        return (r: any) => (r?.indexability?.indexability ?? 0.5) < 0.5;
      default: {
        // The Issues pane publishes "issue:<registry id>"; re-run that issue's
        // own detector and keep only the URLs it flags, so selecting an issue
        // narrows the table to exactly the affected pages.
        const kind = tableFilter?.kind || "";
        if (kind.startsWith("issue:")) {
          const id = Number(kind.slice(6));
          const def = ISSUE_REGISTRY.find((d: any) => d.id === id);
          if (!def) return null;
          let flagged: Set<string>;
          try {
            const blocked = useGlobalCrawlStore.getState().robotsBlocked || [];
            flagged = new Set(
              (def.detect(rows || [], blocked) || [])
                .map((r: any) => r?.url)
                .filter(Boolean),
            );
          } catch {
            return null;
          }
          return (r: any) => flagged.has(r?.url);
        }
        return null;
      }
    }
  }, [tableFilter, rows]);

  const filteredRows = useMemo(() => {
    if (!rows || !Array.isArray(rows)) return [];

    let base = tilePredicate ? rows.filter(tilePredicate) : rows;
    if (!searchTerm) return base;

    const normalizeText = (text: string) =>
      text?.toString().toLowerCase().replace(/-/g, "") ?? "";

    const searchTermNormalized = normalizeText(searchTerm);

    return base.filter((row) => {
      if (!row || typeof row !== "object") return false;
      return Object.values(row).some((value) =>
        normalizeText(value?.toString()).includes(searchTermNormalized),
      );
    });
  }, [rows, searchTerm, tilePredicate]);

  // Use a ref for getItemKey so the callback identity is stable across re-renders.
  // Click-to-sort sits between filtering and virtualisation: the virtualizer
  // only ever sees the final ordered array, so scrolling can't undo the sort.
  const { sortedRows, sort, toggleSort, setSort } = useTableSort(
    filteredRows,
    getRowValues,
  );

  // Clicking a status tile should also bring that column to the front of the
  // ordering, which is what makes the result read as "show me the 4xx pages".
  const STATUS_CODE_COLUMN = 10;
  useEffect(() => {
    if (!tableFilter) return;
    if (["3xx", "4xx", "5xx"].includes(tableFilter.kind)) {
      setSort({ column: STATUS_CODE_COLUMN, direction: "desc" });
    }
  }, [tableFilter, setSort]);

  // This prevents the virtualizer from recomputing all keys when filteredRows changes.
  const filteredRowsRef = useRef(sortedRows);
  filteredRowsRef.current = sortedRows;

  const stableGetItemKey = useCallback(
    (index: number) =>
      `${filteredRowsRef.current[index]?.url || "row"}-${index}`,
    [],
  );

  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    initialRect: { width: 1000, height: rowHeight },
    overscan,
    getItemKey: stableGetItemKey,
  });

  const debouncedSearch = useMemo(
    () => debounce((value: string) => setSearchTerm(value), 500),
    [],
  );

  useEffect(() => {
    return () => {
      debouncedSearch.cancel();
    };
  }, [debouncedSearch]);

  const handleMouseDown = useCallback(
    (index: number, event: React.MouseEvent) => {
      setIsResizing(index);
      startXRef.current = event.clientX;
      event.preventDefault();
    },
    [],
  );

  const rafRef = useRef<number | null>(null);

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (isResizing === null) return;

      const evtX = event.clientX;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      rafRef.current = requestAnimationFrame(() => {
        setColumnWidths((prevWidths) => {
          const delta = evtX - startXRef.current;
          const newWidths = [...prevWidths];
          const currentWidth = Number.parseInt(newWidths[isResizing]);
          newWidths[isResizing] = `${Math.max(50, currentWidth + delta)}px`;
          startXRef.current = evtX;
          return newWidths;
        });
      });
    },
    [isResizing],
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(null);
  }, []);

  useEffect(() => {
    if (isResizing !== null) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);

      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const toggleColumnAlignment = useCallback((index: number) => {
    setColumnAlignments((prev) => {
      const newAlignments = [...prev];
      newAlignments[index] =
        newAlignments[index] === "center" ? "left" : "center";
      return newAlignments;
    });
  }, []);

  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <>
      <div className="text-xs dark:bg-brand-darker sticky top-0 flex gap-1 not-selectable z-20 pb-1 ">
        <input
          type="text"
          placeholder="جستجو..."
          onChange={(e) => debouncedSearch(e.target.value)}
          className="w-full p-1 pl-2 h-6 bg-white dark:bg-brand-darker border dark:border-brand-dark dark:text-white rounded-r outline-none focus:border-blue-500"
        />
        <DownloadButton
          data={"data"}
          download={handleDownload}
          loading={isGeneratingExcel}
          setLoading={setIsGeneratingExcel}
        />
        <div className="mr-1.5">
          <ColumnPicker
            columnVisibility={columnVisibility}
            setColumnVisibility={setColumnVisibility}
            headerTitles={headerTitles}
          />
        </div>
        <div className="h-[5px] border-b dark:border-b-brand-dark  bg-white dark:bg-brand-darker w-full absolute -bottom-[0] -mb-1 z-50" />
      </div>

      {/* Makes an active overview-tile filter visible and undoable — otherwise
          a table showing 2 of 129 rows just looks broken. */}
      {tableFilter && !tableFilter.kind.includes(":") && (
        <div className="flex items-center gap-2 px-3 py-1 text-[11px] bg-brand-bright/10 border-b border-brand-bright/30">
          <span className="font-bold text-brand-bright">
            فیلتر فعال: {tableFilter.label}
          </span>
          <span className="text-gray-500 dark:text-white/40 font-mono">
            {sortedRows.length} از {rows?.length || 0}
          </span>
          <button
            onClick={() => setTableFilter(null)}
            className="ml-auto px-2 py-0.5 rounded border border-brand-bright/40 text-brand-bright hover:bg-brand-bright hover:text-white transition-colors"
          >
            حذف فیلتر ✕
          </button>
        </div>
      )}

      <div
        ref={parentRef}
        className="w-full h-[calc(100%-2rem)] overflow-auto relative"
      >
        <div className="sticky top-0 z-10">
          <TableHeader
            headers={headerTitles}
            columnWidths={columnWidths}
            columnAlignments={columnAlignments}
            onResize={handleMouseDown}
            onAlignToggle={toggleColumnAlignment}
            onSort={toggleSort}
            sort={sort}
            columnVisibility={columnVisibility}
          />
        </div>

        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: "relative",
          }}
          className="domainCrawlParent"
        >
          {sortedRows.length > 0 ? (
            virtualRows.map((virtualRow) => (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: `${virtualRow.start}px`,
                  left: 0,
                  width: "100%",
                  height: `${virtualRow.size}px`,
                }}
              >
                <TableRow
                  row={sortedRows[virtualRow.index]}
                  index={virtualRow.index}
                  columnWidths={columnWidths}
                  columnAlignments={columnAlignments}
                  columnVisibility={columnVisibility}
                  isSelected={clickedCell.row === virtualRow.index}
                  handleCellClick={handleCellClick}
                  onCellDoubleClick={handleCellDoubleClick}
                />
              </div>
            ))
          ) : (
            <div className="text-center py-4 text-xs text-gray-500">
              داده‌ای موجود نیست.
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default memo(TableCrawl);
