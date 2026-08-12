// Column configurations
export const initialColumnWidths = [
  "30px", // ID
  "1000px", // URL
];

export const initialColumnAlignments = [
  "center", // ID
  "left", // URL
];

export const headerTitles = ["ID", "URL"];

// The exact cell array the TableRow renders. Shared with the sort comparator
// so the values sorted on are always the values shown.
export function getRowValues(row: any, index: number): any[] {
  return [index + 1, row?.url || ""];
}
