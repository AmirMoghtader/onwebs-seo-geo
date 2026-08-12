// Column configurations
export const initialColumnWidths = [
  "60px", // ID
  "150px", // Anchor
  "150px", // URL
  "600px", // Rel
  "100px", // Title
  "100px", // Target
  "110px", // Status Code
  "320px", // Page
  "90px", // Link Score
];

export const initialColumnAlignments = [
  "center", // ID
  "left", // Anchor
  "left", // URL
  "left", // Rel
  "left", // Title
  "left", // Target
  "center", // Status Code
  "left", // Status Code
  "center", // Link Score
];

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
  return [
    index + 1,
    row?.anchor || "",
    row?.rel || "",
    row?.link || "",
    row?.title || "",
    row?.target || "",
    row?.status || "",
    row?.page || "",
    row?.linkScore ?? "",
  ];
}

export const headerTitles = [
  "ID",
  "Anchor Text",
  "Rel",
  "Link",
  "Title",
  "Target",
  "Status Code",
  "Page",
  "Link Score",
];
