// Save and re-open a crawl, the way Screaming Frog's File > Save / Open works.
//
// Current files are compact SQLite containers copied directly from the complete
// crawl database. Version-1 JSON files remain readable for compatibility.

import { save, open } from "@tauri-apps/plugin-dialog";
import { writeFile, readFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

export const CRAWL_FILE_VERSION = 2;
export const CRAWL_FILE_EXTENSION = "onwebscrawl";

export interface CrawlFile {
  version: number;
  savedAt: string;
  domain: string;
  pageCount: number;
  rows: any[];
}

export interface SavedCrawlFile {
  path: string;
  pageCount: number;
}

interface NativeCrawlInfo {
  version: number;
  saved_at: string;
  domain: string;
  page_count: number;
}

let legacyFingerprint: string | null = null;

const fingerprint = (rows: any[]) =>
  `${domainOf(rows)}|${rows?.length || 0}|${rows?.[0]?.url || ""}|${rows?.at?.(-1)?.url || ""}`;

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
export async function saveCrawl(rows: any[]): Promise<SavedCrawlFile | null> {
  const domain = domainOf(rows);
  const stamp = new Date().toISOString().slice(0, 10);

  const path = await save({
    defaultPath: `${domain}-${stamp}.${CRAWL_FILE_EXTENSION}`,
    filters: [
      { name: "Onwebs Crawl", extensions: [CRAWL_FILE_EXTENSION] },
    ],
  });
  if (!path) return null;

  // Files opened from the legacy JSON format may not exist in the active DB.
  // Preserve that data in its original compatible form. Normal crawls and
  // native files are exported directly from SQLite with every row/column.
  if (rows?.length && legacyFingerprint === fingerprint(rows)) {
    const payload: CrawlFile = {
      version: 1,
      savedAt: new Date().toISOString(),
      domain,
      pageCount: rows.length,
      rows,
    };
    await writeFile(path, new TextEncoder().encode(JSON.stringify(payload)));
    return { path, pageCount: rows.length };
  }

  try {
    const info = await invoke<NativeCrawlInfo>("save_crawl_file_command", { path });
    return { path, pageCount: info.page_count };
  } catch (error) {
    if (String(error).includes("No crawl")) throw new Error("EMPTY");
    throw error;
  }
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

  try {
    const info = await invoke<NativeCrawlInfo>("open_crawl_file_command", {
      path: path as string,
    });
    const rows = (await invoke("get_crawl_page_command", {
      // Keep the UI store bounded; the complete crawl remains queryable in DB.
      limit: Math.min(info.page_count, 5000),
      offset: 0,
      search: null,
    })) as any[];
    legacyFingerprint = null;
    return {
      version: info.version,
      savedAt: info.saved_at,
      domain: info.domain,
      pageCount: info.page_count,
      rows,
    };
  } catch (nativeError) {
    if (String(nativeError).includes("newer than supported")) {
      throw new Error("NEWER_VERSION");
    }
    // Version 1 was JSON. Fall through to the old reader so existing user
    // files remain usable after the native SQLite format upgrade.
  }

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

  const legacyFile = {
    version: parsed.version ?? 0,
    savedAt: parsed.savedAt || "",
    domain: parsed.domain || domainOf(parsed.rows),
    pageCount: parsed.rows.length,
    rows: parsed.rows,
  };
  legacyFingerprint = fingerprint(legacyFile.rows);
  return legacyFile;
}
