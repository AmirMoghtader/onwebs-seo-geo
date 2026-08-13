// Screaming Frog reports two different byte counts for a page and they are not
// interchangeable: `Size` is the resource uncompressed, `Transferred` is what
// actually crossed the network. websima.com's homepage is 284,955 bytes of
// HTML delivered in 34,192 bytes of gzip — an eight-fold difference, and the
// only reason the pair of columns exists.
//
// Both were broken here. `Size` read `page_size[0].bytes`, a key the crawler
// never writes (it writes `length`), so the column was blank on every row of
// every crawl. `Transferred` was filled with the decompressed body length,
// making it equal `Size` on 821 of 838 pages.

export interface PageSize {
  /** Uncompressed bytes. */
  sizeBytes: number | "";
  /** Bytes over the wire, blank when the response gave us no way to know. */
  transferredBytes: number | "";
}

const asBytes = (v: unknown): number | "" =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : "";

export function pageSizeFor(page: any): PageSize {
  const entry = Array.isArray(page?.page_size) ? page.page_size[0] : undefined;

  return {
    // `bytes` is accepted so rows written by older builds still resolve.
    sizeBytes:
      asBytes(entry?.length) ||
      asBytes(entry?.bytes) ||
      asBytes(page?.content_length),
    transferredBytes: asBytes(page?.page_meta?.transferred_bytes),
  };
}
