// Guessing a content type from a URL.
//
// Assets are discovered as references inside a page's HTML — an `<img src>`, a
// `<link rel=stylesheet>` — and never parsed, so no response header is on hand
// when a row for one is first built. The extension is all there is to go on.

export function extFromUrl(url: string): string {
  try {
    const path = String(url).split(/[?#]/)[0];
    const last = path.split("/").pop() || "";
    const dot = last.lastIndexOf(".");
    return dot > -1 ? last.slice(dot + 1).toLowerCase() : "";
  } catch {
    return "";
  }
}

export const EXT_CONTENT_TYPE: Record<string, string> = {
  js: "application/javascript", mjs: "application/javascript", css: "text/css",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  eot: "application/vnd.ms-fontobject", pdf: "application/pdf",
  xml: "application/xml", json: "application/json", mp4: "video/mp4",
  webm: "video/webm", mp3: "audio/mpeg", zip: "application/zip",
};

export function contentTypeFor(url: string, fallback?: string): string {
  if (fallback) return fallback;
  return EXT_CONTENT_TYPE[extFromUrl(url)] || "";
}
