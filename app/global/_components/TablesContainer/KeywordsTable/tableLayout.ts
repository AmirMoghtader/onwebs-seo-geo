// Column configurations
export const initialColumnWidths = [
  "30px", // ID
  "120px", // Anchor
  "1000px", // URL
];

export const initialColumnAlignments = [
  "center", // ID
  "left", // Anchor
  "left", // URL
];

/**
 * The value shown in each column, in header order.
 *
 * This used to live inside TableRow's useMemo, which meant the parent — the
 * component that actually owns the row array — had no way to ask "what does
 * column 3 show for this row?" and so could not sort. It is a pure function
 * now so TableRow and the sort comparator read from exactly one definition and
 * can never drift apart.
 *
 * Unlike the other tables, this one has a dynamic number of keyword columns
 * (one per `Top N` slot, sized by the widest row), so the column list is passed
 * in as a trailing argument. It defaults to `[]` purely to keep the function
 * usable as a bare `(row, index)` accessor; callers that care about the keyword
 * columns must pass them.
 */
export function getRowValues(
  row: any,
  index: number,
  keywordColumns: any[] = [],
): any[] {
  const data = [index + 1, row.url || ""];
  keywordColumns.forEach((_, i) => {
    const kwData = row.keywords?.[i];
    const kw = kwData?.[0] || "";
    const count = kwData?.[1] || 0;
    data.push({ kw, count });
  });
  return data;
}

export const headerTitles = ["ID", "URL", "Keywords"];
