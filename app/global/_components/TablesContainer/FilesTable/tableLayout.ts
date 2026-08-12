export const initialColumnWidths = ["50px", "1fr", "100px", "1fr"];
export const initialColumnAlignments = ["center", "left", "center", "left"];
export const headerTitles = ["ID", "URL", "FileType", "Found At"];

/**
 * The value shown in each column, in header order.
 *
 * This used to live inside TableRow's useMemo, which meant the parent — the
 * component that actually owns the row array — had no way to ask "what does
 * column 3 show for this row?" and so could not sort. It is a pure function
 * now so TableRow and the sort comparator read from exactly one definition and
 * can never drift apart.
 */
export function getRowValues(row: any, index: number): any[] {
  return [row.id, row.url, row.filetype, row.found_at];
}
