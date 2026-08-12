// Builds Screaming Frog's Site Structure view from the crawled URLs:
// a directory tree of the site with a URL count on every node, plus the
// crawl-depth histogram that sits beneath it.

export interface TreeNode {
  key: string;
  /** segment shown in the Path column, e.g. "blog/" */
  label: string;
  /** how many crawled URLs live at or below this node */
  urls: number;
  level: number;
  children: TreeNode[];
  /** the full URL when this node is a page rather than a folder */
  url?: string;
}

/**
 * Groups every crawled URL by its path segments. The root is the scheme, then
 * the host, then each directory — which is exactly how SF lays it out.
 */
export function buildPathTree(rows: any[]): { root: TreeNode | null; maxLevel: number } {
  const urls: string[] = (rows || []).map((r) => r?.url).filter(Boolean);
  if (!urls.length) return { root: null, maxLevel: 0 };

  const root: TreeNode = {
    key: "__root__",
    label: "",
    urls: 0,
    level: 0,
    children: [],
  };

  let maxLevel = 0;

  const childOf = (node: TreeNode, label: string, level: number): TreeNode => {
    let found = node.children.find((c) => c.label === label);
    if (!found) {
      found = {
        key: `${node.key}/${label}`,
        label,
        urls: 0,
        level,
        children: [],
      };
      node.children.push(found);
    }
    return found;
  };

  for (const raw of urls) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }

    // scheme node, then host node
    const scheme = childOf(root, `${parsed.protocol}//`, 1);
    scheme.urls++;
    const host = childOf(scheme, `${parsed.host}/`, 2);
    host.urls++;

    const segments = decodeURI(parsed.pathname)
      .split("/")
      .filter(Boolean);

    let cursor = host;
    segments.forEach((seg, i) => {
      const isLast = i === segments.length - 1;
      // A trailing segment with no extension is still a page, not a folder;
      // SF shows folders with a slash and leaf pages without one.
      const label = isLast && seg.includes(".") ? seg : isLast ? seg : `${seg}/`;
      cursor = childOf(cursor, label, cursor.level + 1);
      cursor.urls++;
      if (isLast) cursor.url = raw;
      maxLevel = Math.max(maxLevel, cursor.level);
    });
  }

  root.urls = urls.length;

  // Deepest and busiest first, so the interesting branches are at the top.
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => b.urls - a.urls || a.label.localeCompare(b.label));
    n.children.forEach(sortRec);
  };
  sortRec(root);

  return { root, maxLevel };
}

export interface DepthBucket {
  depth: string;
  blocked: number;
  noResponse: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
}

/**
 * Crawl-depth histogram, split by response class — the stacked bar chart under
 * the tree. Depths past 10 collapse into a single "10+" bucket, as SF does.
 */
export function buildDepthHistogram(rows: any[], blockedUrls: string[] = []): DepthBucket[] {
  const blocked = new Set(blockedUrls || []);
  const buckets = new Map<number, DepthBucket>();

  const bucketFor = (d: number): DepthBucket => {
    const key = d > 10 ? 10 : d;
    let b = buckets.get(key);
    if (!b) {
      b = {
        depth: key === 10 ? "10+" : String(key),
        blocked: 0,
        noResponse: 0,
        s2xx: 0,
        s3xx: 0,
        s4xx: 0,
        s5xx: 0,
      };
      buckets.set(key, b);
    }
    return b;
  };

  // Always render 0..10 so the axis doesn't jump around between crawls.
  for (let i = 0; i <= 10; i++) bucketFor(i);

  for (const r of rows || []) {
    const depth = Number(r?.url_depth);
    const b = bucketFor(Number.isFinite(depth) ? depth : 0);
    const code = Number(r?.status_code) || 0;

    if (r?.url && blocked.has(r.url)) b.blocked++;
    else if (code === 0) b.noResponse++;
    else if (code >= 500) b.s5xx++;
    else if (code >= 400) b.s4xx++;
    else if (code >= 300) b.s3xx++;
    else b.s2xx++;
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v);
}
