// Column configurations
export const initialColumnWidths = [
  "50px", // ID
  "250px", // Alt Text
  "1fr", // URL - fills remaining space
  "100px", // Image Size
  "100px", // Image Type
  "100px", // Status Code
];

export const initialColumnAlignments = [
  "center", // ID
  "left", // Alt Text
  "left", // URL
  "center", // Image Size
  "center", // Image Type
  "center", // Status Code
];

export const headerTitles = [
  "ID",
  "Alt Text",
  "URL",
  "Image Size",
  "Image Type",
  "Status Code",
];

// The exact cell values a TableRow renders, pulled out as a pure function so
// the sort comparator can see the same strings the user sees on screen.
export function getRowValues(row: any, index: number): any[] {
  return [
    index + 1,
    row[1] || "", // Alt text
    row[0] || "", // URL
    !isNaN(Number(row[2])) && Number(row[2]) > 0
      ? (Number(row[2]) / 1024).toFixed(2) + " KB"
      : "0 KB", // Size in KB
    row[3] || "", // Type
    row[4] || "", // Status
  ];
}
