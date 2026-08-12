// @ts-nocheck
import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
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
} from "../components/tableLayout";
import {
  useTableSort,
  sortIndicator,
  type SortState,
} from "../components/useTableSort";

/**
 * The value shown in each column, in header order.
 *
 * This table renders a shorter column set than the shared crawl layout, so it
 * keeps its own accessor rather than importing tableLayout's. It used to live
 * inside TableRow's useMemo, which meant the parent — the component that
 * actually owns the row array — had no way to ask "what does column 3 show for
 * this row?" and so could not sort. It is a pure function now so TableRow and
 * the sort comparator read from exactly one definition and can never drift
 * apart.
 */
export function getRowValues(row: any, index: number): any[] {
  return [
    index + 1,
    row?.url || "",
    row?.title?.[0]?.title || "",
    row?.title?.[0]?.title_len || "",
    row?.headings?.h1?.[0] || "",
    row?.headings?.h1?.[0]?.length || "",
    row?.headings?.h2?.[0] || "",
    row?.headings?.h2?.[0]?.length || "",
    row?.status_code || "",
    row?.word_count || "",
    row?.mobile ? "Yes" : "No",
    row?.meta_robots?.meta_robots[0] || "",
  ];
}

interface TableCrawlProps {
  rows: Array<{
    url?: string;
    title?: Array<{ title?: string; title_len?: string }>;
    headings?: { h1?: string[]; h2?: string[] };
    status_code?: number;
    word_count?: number;
    mobile?: boolean;
    meta_robots?: { meta_robots: string[] };
  }>;
  rowHeight?: number;
  overscan?: number;
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
  clickedCell: { row: number | null; cell: number | null };
  handleCellClick: (rowIndex: number, cellIndex: number) => void;
}

interface ColumnPickerProps {
  columnVisibility: boolean[];
  setColumnVisibility: (visibility: boolean[]) => void;
  headerTitles: string[];
}

const TruncatedCell = ({
  text,
  maxLength = 90,
  width = "auto",
}: TruncatedCellProps) => {
  const truncatedText = useMemo(() => {
    if (!text) return "";
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  }, [text, maxLength]);

  return useMemo(
    () => (
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
    ),
    [width, truncatedText],
  );
};

const ResizableDivider = ({ onMouseDown }: ResizableDividerProps) => {
  return useMemo(
    () => (
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
    ),
    [onMouseDown],
  );
};

const TableHeader = ({
  headers,
  columnWidths,
  columnAlignments,
  onResize,
  onAlignToggle,
  onSort,
  sort,
  columnVisibility,
}: TableHeaderProps) => {
  return useMemo(
    () => (
      <thead className="sticky top-0 z-10 domainCrawl border">
        <tr>
          {headers.map((header, index) =>
            columnVisibility[index] ? (
              <th
                key={header}
                style={{
                  width: columnWidths[index],
                  position: "relative",
                  border: "1px solid #ddd",
                  padding: "8px",
                  userSelect: "none",
                  minWidth: columnWidths[index],
                  textAlign: columnAlignments[index],
                  backgroundColor: "var(--background, white)",
                  cursor: "pointer",
                }}
                onClick={() => onSort(index)}
                onDoubleClick={(e) => {
                  // Alignment used to own the single click; sorting needs it, so
                  // alignment moved to double-click.
                  e.stopPropagation();
                  onAlignToggle(index);
                }}
                title="کلیک: مرتب‌سازی (نزولی → صعودی → بدون مرتب‌سازی) — دوبار کلیک: تغییر چیدمان ستون"
              >
                {header}
                <span
                  style={{
                    marginInlineStart: 4,
                    fontSize: 10,
                    color: "var(--brand-bright, #2B6CC4)",
                  }}
                >
                  {sortIndicator(sort, index)}
                </span>
                <ResizableDivider onMouseDown={(e) => onResize(index, e)} />
              </th>
            ) : null,
          )}
        </tr>
      </thead>
    ),
    [
      headers,
      columnWidths,
      columnAlignments,
      onResize,
      onAlignToggle,
      onSort,
      sort,
      columnVisibility,
    ],
  );
};

const TableRow = ({
  row,
  index,
  columnWidths,
  columnAlignments,
  columnVisibility,
  clickedCell,
  handleCellClick,
}: TableRowProps) => {
  // Shared with the sort comparator via getRowValues so the values sorted on
  // are always the values rendered.
  const rowData = useMemo(() => getRowValues(row, index), [row, index]);

  return useMemo(
    () => (
      <>
        {rowData.map((cell, cellIndex) =>
          columnVisibility[cellIndex] ? (
            <td
              key={`cell-${index}-${cellIndex}`}
              onClick={() => handleCellClick(index, cellIndex, cell.toString())}
              style={{
                width: columnWidths[cellIndex],
                border: "1px solid #ddd",
                padding: "8px",
                textAlign: columnAlignments[cellIndex],
                overflow: "hidden",
                whiteSpace: "nowrap",
                minWidth: columnWidths[cellIndex],
                backgroundColor:
                  clickedCell.row === index && clickedCell.cell === cellIndex
                    ? "#2B6CC4"
                    : "transparent",
                color:
                  clickedCell.row === index && clickedCell.cell === cellIndex
                    ? "white"
                    : "inherit",
              }}
              className="dark:text-white/50 cursor-pointer"
            >
              <TruncatedCell
                text={cell?.toString()}
                width={columnWidths[cellIndex]}
              />
            </td>
          ) : null,
        )}
      </>
    ),
    [
      rowData,
      columnWidths,
      columnAlignments,
      columnVisibility,
      index,
      clickedCell,
      handleCellClick,
    ],
  );
};

const ColumnPicker = ({
  columnVisibility,
  setColumnVisibility,
  headerTitles,
}: ColumnPickerProps) => {
  const handleToggle = useCallback(
    (index: number) => {
      setColumnVisibility((prev) => {
        const newVisibility = [...prev];
        newVisibility[index] = !newVisibility[index];
        return newVisibility;
      });
    },
    [setColumnVisibility],
  );

  return useMemo(
    () => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="p-1 dark:bg-brand-darker border dark:border-brand-dark dark:text-white border-gray-300 rounded dark:text-white/50">
            ستون‌ها
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-32 bg-white dark:bg-brand-darker border dark:border-brand-dark rounded shadow-lg z-20">
          {headerTitles.map((header, index) => (
            <DropdownMenuCheckboxItem
              key={header}
              checked={columnVisibility[index] ?? true}
              onCheckedChange={() => handleToggle(index)}
              className="p-2 hover:bg-gray-100 w-fit dark:hover:bg-brand-dark space-x-6 dark:text-white text-brand-bright"
            >
              <span className="ml-5 dark:text-brand-bright">{header}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    [columnVisibility, handleToggle, headerTitles],
  );
};

const Table404 = ({ rows, rowHeight = 41, overscan = 10 }: TableCrawlProps) => {
  const [columnWidths, setColumnWidths] = useState(initialColumnWidths);
  const [columnAlignments, setColumnAlignments] = useState(
    initialColumnAlignments,
  );
  const [isResizing, setIsResizing] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [columnVisibility, setColumnVisibility] = useState(
    headerTitles.map(() => true),
  );

  // State to track the clicked cell (rowIndex, cellIndex)
  const [clickedCell, setClickedCell] = useState<{
    row: number | null;
    cell: number | null;
  }>({
    row: null,
    cell: null,
  });

  // Handle cell click
  const handleCellClick = useCallback(
    (rowIndex: number, cellIndex: number, cellContent: string) => {
      setClickedCell((prevClickedCell) => {
        if (
          prevClickedCell.row === rowIndex &&
          prevClickedCell.cell === cellIndex
        ) {
          // If the clicked cell is already highlighted, unhighlight it
          return { row: null, cell: null };
        } else {
          // Otherwise, highlight the clicked cell
          return { row: rowIndex, cell: cellIndex };
        }
      });

      if (cellIndex === 1) {
        console.log("This is the url");
      }

      console.log(cellContent, rowIndex, cellIndex);
    },
    [],
  );

  const startXRef = useRef(0);
  const parentRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Memoize filtered rows
  const filteredRows = useMemo(() => {
    if (!rows || !Array.isArray(rows)) return [];

    const normalizeText = (text: string) =>
      text?.toString().toLowerCase().replace(/-/g, "") ?? "";

    const searchTermNormalized = normalizeText(searchTerm);

    return searchTerm
      ? rows.filter((row) => {
          if (!row || typeof row !== "object") return false;
          return Object.values(row).some((value) =>
            normalizeText(value?.toString()).includes(searchTermNormalized),
          );
        })
      : rows;
  }, [rows, searchTerm]);

  // Click-to-sort sits between filtering and virtualisation: the virtualizer
  // only ever sees the final ordered array, so scrolling can't undo the sort.
  const { sortedRows, sort, toggleSort } = useTableSort(
    filteredRows,
    getRowValues,
  );

  // Initialize virtualizer
  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    initialRect: { width: 1000, height: rowHeight },
    overscan,
  });

  // Debounced search handler
  const debouncedSearch = useMemo(
    () => debounce((value: string) => setSearchTerm(value), 500),
    [],
  );

  // Cleanup
  useEffect(() => {
    return () => {
      debouncedSearch.cancel();
    };
  }, [debouncedSearch]);

  // Column resizing handlers
  const handleMouseDown = useCallback(
    (index: number, event: React.MouseEvent) => {
      setIsResizing(index);
      startXRef.current = event.clientX;
      event.preventDefault();
    },
    [],
  );

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (isResizing === null) return;

      const delta = event.clientX - startXRef.current;
      setColumnWidths((prevWidths) => {
        const newWidths = [...prevWidths];
        const currentWidth = parseInt(newWidths[isResizing]);
        newWidths[isResizing] = `${Math.max(50, currentWidth + delta)}px`;
        return newWidths;
      });
      startXRef.current = event.clientX;
    },
    [isResizing],
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(null);
  }, []);

  // Event listeners for resizing
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

  // Calculate total table width
  const totalWidth = useMemo(
    () =>
      columnWidths.reduce((acc, width) => {
        if (typeof width === "string") {
          if (width.endsWith("px")) {
            return acc + parseFloat(width);
          } else if (width.endsWith("rem")) {
            return acc + parseFloat(width) * 16;
          }
        }
        return acc + 100;
      }, 0),
    [columnWidths],
  );

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
    <div className="flex flex-col h-full w-full min-h-0 relative">
      <div className="text-xs dark:bg-brand-darker sticky top-0 flex gap-2">
        <input
          type="text"
          placeholder="جستجو..."
          onChange={(e) => debouncedSearch(e.target.value)}
          className="w-full p-1 pl-2 dark:bg-brand-darker border dark:border-brand-dark dark:text-white border-gray-300 rounded"
        />
        <div className="mr-1.5">
          <ColumnPicker
            columnVisibility={columnVisibility}
            setColumnVisibility={setColumnVisibility}
            headerTitles={headerTitles}
          />
        </div>
      </div>
      <div
        ref={parentRef}
        className="w-full flex-1 min-h-0 overflow-auto relative"
      >
        <div
          ref={tableContainerRef}
          style={{ minWidth: `${totalWidth}px` }}
          className="domainCrawlParent"
        >
          <table className="w-full text-xs border-collapse domainCrawlParent h-full">
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
            <tbody>
              {sortedRows.length > 0 ? (
                <>
                  <tr
                    style={{
                      height: `${virtualRows[0]?.start || 0}px`,
                    }}
                  />
                  {virtualRows.map((virtualRow) => (
                    <tr key={virtualRow.key}>
                      <TableRow
                        row={sortedRows[virtualRow.index]}
                        index={virtualRow.index}
                        columnWidths={columnWidths}
                        columnAlignments={columnAlignments}
                        columnVisibility={columnVisibility}
                        clickedCell={clickedCell}
                        handleCellClick={handleCellClick}
                      />
                    </tr>
                  ))}
                  <tr
                    style={{
                      height: `${Math.max(0, rowVirtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end || 0))}px`,
                    }}
                  />{" "}
                </>
              ) : (
                <tr>
                  <td
                    colSpan={headerTitles.length}
                    className="text-center py-4"
                  >
                    داده‌ای موجود نیست.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Table404;
