// Column configurations
export const initialColumnWidths = [
  "30px", // ID
  "1000px", // URL
];

export const initialColumnAlignments = [
  "center", // ID
  "left", // URL
];

/**
 * The value shown in each column, in header order.
 *
 * This used to live inside TableRow's useMemo, which meant the parent — the
 * component that actually owns the row array — had no way to ask "what does
 * column 1 show for this row?" and so could not sort. It is a pure function
 * now so TableRow and the sort comparator read from exactly one definition and
 * can never drift apart.
 */
export function getRowValues(row: any, index: number): any[] {
  return [index + 1, row?.url || ""];
}

export const headerTitles = ["ID", "URL"];
