// Pixel width of a title or meta description as Google would render it.
//
// Character count is a poor proxy for SERP truncation — "IIII" and "WWWW" are
// both 4 characters but nowhere near the same width — which is why Screaming
// Frog reports pixels alongside length. Google renders desktop titles at
// roughly Arial 20px and descriptions at Arial 14px, and truncates at about
// 561px and 985px respectively.
//
// Measured with canvas rather than a lookup table so non-Latin scripts (the
// Persian titles on this site, for instance) come out right instead of being
// approximated by Latin character widths.

export const TITLE_PIXEL_LIMIT = 561;
export const DESCRIPTION_PIXEL_LIMIT = 985;

let ctx: CanvasRenderingContext2D | null | undefined;

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    const canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  return ctx;
}

const cache = new Map<string, number>();

export function pixelWidth(text: string, font: string): number {
  if (!text) return 0;
  const key = `${font}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const c = context();
  if (!c) {
    // Server render or no canvas: fall back to a rough average so the field
    // shows something plausible rather than zero.
    const approx = Math.round(text.length * (font.startsWith("20") ? 9.5 : 6.8));
    cache.set(key, approx);
    return approx;
  }

  c.font = font;
  const w = Math.round(c.measureText(text).width);
  cache.set(key, w);
  return w;
}

export const titlePixels = (t: string) => pixelWidth(t, "20px Arial, sans-serif");
export const descriptionPixels = (t: string) =>
  pixelWidth(t, "14px Arial, sans-serif");

/**
 * How much of the string Google would actually show, and what is left over.
 * `remaining` goes negative once the text overflows, which is what SF colours
 * red in the SERP Snippet panel.
 */
export function truncation(text: string, limit: number, measure: (t: string) => number) {
  const total = measure(text || "");
  if (!text) {
    return { length: text?.length || 0, displayed: 0, truncated: 0, pixels: 0, available: limit, remaining: limit };
  }
  if (total <= limit) {
    return {
      length: text.length,
      displayed: text.length,
      truncated: 0,
      pixels: total,
      available: limit,
      remaining: limit - total,
    };
  }
  // Binary search the longest prefix that still fits.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid)) <= limit) lo = mid;
    else hi = mid - 1;
  }
  return {
    length: text.length,
    displayed: lo,
    truncated: text.length - lo,
    pixels: total,
    available: limit,
    remaining: limit - total,
  };
}
