export const initialColumnWidths = [
  "50px", // ID
  "minmax(600px, auto)", // Page
  "80px", // Redirected
  "minmax(600px, auto)", // Destination
  "80px", // Type
  "80px", // Status
  "60px", // Hops
  "60px", // Loop
  "minmax(600px, auto)", // Chain
];

export const initialColumnAlignments = [
  "center", // ID
  "left", // Page
  "center", // Redirected
  "left", // Destination
  "center", // Type
  "center", // Status
  "center", // Hops
  "center", // Loop
  "left", // Chain
];

export function getRowValues(row: any, index: number): any[] {
  // Determine if there is a loop
  let isLoop = false;
  if (row?.redirect_chain && Array.isArray(row.redirect_chain)) {
    const seen = new Set<string>();
    // Add original URL to start to detect loops back to start
    if (row.original_url) seen.add(row.original_url.trim().toLowerCase());

    for (const hop of row.redirect_chain) {
      if (hop.url) {
        const lowerUrl = hop.url.trim().toLowerCase();
        if (seen.has(lowerUrl)) {
          isLoop = true;
          break;
        }
        seen.add(lowerUrl);
      }
    }
  }

  return [
    index + 1,
    row?.original_url || "",
    // The trailing `|| ""` this carried was dead — the false branch is the
    // string "No", which is always truthy. Dropping it is behaviour-identical
    // and lets this file typecheck without a blanket @ts-nocheck.
    row?.had_redirect ? "Yes" : "No",
    row?.redirect_url || "",
    row?.redirection_type || "",
    row?.status || "",
    row?.redirect_count || 0,
    isLoop,
    row?.redirect_chain || [],
  ];
}

export const headerTitles = [
  "ID",
  "Page",
  "Redirected",
  "Destination",
  "Type",
  "Status",
  "Hops",
  "Loop",
  "Chain",
];
