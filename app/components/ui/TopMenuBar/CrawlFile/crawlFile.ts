// Save and re-open a crawl, the way Screaming Frog's File > Save / Open works.
//
// The crawl database only ever holds the most recent run — starting a new crawl
// overwrites it — so without this a crawl is gone the moment you start the next
// one. Writing the rows to a file the user picks means a crawl can be kept for
// comparison, handed to someone else, or reopened weeks later.
//
// Stored as JSON with a version marker so a file written today still loads if
// the row shape changes later.

import { save, open } from "@tauri-apps/plugin-dialog";
import { writeFile, readFile } from "@tauri-apps/plugin-fs";

export const CRAWL_FILE_VERSION = 1;
export const CRAWL_FILE_EXTENSION = "onwebscrawl";

export interface CrawlFile {
  version: number;
  savedAt: string;
  domain: string;
  pageCount: number;
  rows: any[];
}

function domainOf(rows: any[]): string {
  for (const r of rows) {
    try {
      return new URL(r?.url).host;
    } catch {
      /* keep looking */
    }
  }
  return "unknown";
}

/**
 * Writes the crawl to a file of the user's choosing.
 * Returns the path written, or null when the dialog was cancelled.
 */
export async function saveCrawl(rows: any[]): Promise<string | null> {
  if (!rows?.length) throw new Error("EMPTY");

  const domain = domainOf(rows);
  const stamp = new Date().toISOString().slice(0, 10);

  const path = await save({
    defaultPath: `${domain}-${stamp}.${CRAWL_FILE_EXTENSION}`,
    filters: [
      { name: "Onwebs Crawl", extensions: [CRAWL_FILE_EXTENSION] },
      { name: "JSON", extensions: ["json"] },
    ],
  });
  if (!path) return null;

  const payload: CrawlFile = {
    version: CRAWL_FILE_VERSION,
    savedAt: new Date().toISOString(),
    domain,
    pageCount: rows.length,
    rows,
  };

  await writeFile(path, new TextEncoder().encode(JSON.stringify(payload)));
  return path;
}

/**
 * Reads a saved crawl back. Returns null when the dialog was cancelled, and
 * throws with a specific reason when the file is not one of ours — an
 * unhelpful "failed to open" would leave the user guessing.
 */
export async function openCrawl(): Promise<CrawlFile | null> {
  const path = await open({
    multiple: false,
    filters: [
      { name: "Onwebs Crawl", extensions: [CRAWL_FILE_EXTENSION, "json"] },
    ],
  });
  if (!path || Array.isArray(path)) return null;

  const bytes = await readFile(path as string);
  const text = new TextDecoder().decode(bytes);

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("NOT_JSON");
  }

  if (!parsed || !Array.isArray(parsed.rows)) {
    throw new Error("NOT_A_CRAWL");
  }
  if (typeof parsed.version === "number" && parsed.version > CRAWL_FILE_VERSION) {
    throw new Error("NEWER_VERSION");
  }

  return {
    version: parsed.version ?? 0,
    savedAt: parsed.savedAt || "",
    domain: parsed.domain || domainOf(parsed.rows),
    pageCount: parsed.rows.length,
    rows: parsed.rows,
  };
}
