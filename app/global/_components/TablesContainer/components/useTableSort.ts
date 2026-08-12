// Shared click-to-sort for the crawl tables.
//
// The tables are hand-rolled and virtualised, so sorting has to happen on the
// data array before it reaches the virtualizer — reordering DOM rows would be
// undone on the next scroll. Each table supplies a `getValues(row, index)`
// accessor (the same one its TableRow uses to build cells) so the comparator
// sees exactly what the user sees in that column.

import { useCallback, useMemo, useState } from "react";

export type SortDirection = "desc" | "asc" | null;

export interface SortState {
  /** index into the table's column array, or null when unsorted */
  column: number | null;
  direction: SortDirection;
}

const EMPTY: SortState = { column: null, direction: null };

/** Trailing " KB", thousands separators and stray whitespace off a numeric cell. */
function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[\s,]/g, "").replace(/(KB|MB|B|%|ms|s)$/i, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

// Persian/Arabic and Latin mixed together sort sensibly under the fa collator,
// and it gives us natural numeric ordering inside strings ("Page 2" < "Page 10").
const collator = new Intl.Collator(["fa", "en"], {
  numeric: true,
  sensitivity: "base",
});

/**
 * Compare two cell values. Numeric columns compare numerically, everything
 * else by locale. Blanks always sink to the bottom regardless of direction,
 * so an empty Title never outranks a real one just because you flipped to asc.
 */
export function compareCells(a: unknown, b: unknown, direction: SortDirection): number {
  if (direction === null) return 0;

  const aBlank = isBlank(a);
  const bBlank = isBlank(b);
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;

  const an = asNumber(a);
  const bn = asNumber(b);
  const result =
    an !== null && bn !== null ? an - bn : collator.compare(String(a), String(b));

  return direction === "desc" ? -result : result;
}

/**
 * Click-to-sort state plus a sorted copy of `rows`.
 *
 * Cycle is desc -> asc -> unsorted, matching Screaming Frog: the first click on
 * a column shows you the worst/largest offenders, which is what you almost
 * always want first.
 */
export function useTableSort<T>(
  rows: T[],
  getValues: (row: T, index: number) => unknown[],
) {
  const [sort, setSort] = useState<SortState>(EMPTY);

  const toggleSort = useCallback((column: number) => {
    setSort((prev) => {
      if (prev.column !== column) return { column, direction: "desc" };
      if (prev.direction === "desc") return { column, direction: "asc" };
      return EMPTY;
    });
  }, []);

  const sortedRows = useMemo(() => {
    if (sort.column === null || sort.direction === null) return rows;

    // Decorate with the original index so the ID column (which is positional)
    // and the accessor both see the row's pre-sort position, then sort a copy —
    // never mutate the caller's array.
    return rows
      .map((row, index) => ({ row, index }))
      .sort((x, y) => {
        const xv = getValues(x.row, x.index)[sort.column as number];
        const yv = getValues(y.row, y.index)[sort.column as number];
        const cmp = compareCells(xv, yv, sort.direction);
        // Stable fallback so equal cells keep crawl order instead of jittering.
        return cmp !== 0 ? cmp : x.index - y.index;
      })
      .map((entry) => entry.row);
  }, [rows, getValues, sort]);

  // setSort is exposed so callers can drive the ordering programmatically —
  // e.g. clicking the 4XX overview tile jumps the table to Status Code desc.
  return { sortedRows, sort, toggleSort, setSort };
}

/** Arrow shown next to a header label. Empty string keeps the header width stable. */
export function sortIndicator(sort: SortState, column: number): string {
  if (sort.column !== column || sort.direction === null) return "";
  return sort.direction === "desc" ? " ▼" : " ▲";
}
