// Every URL has two faces, and Screaming Frog shows both: `Address` is the one
// a person reads, `URL Encoded Address` is the one that goes on the wire.
//
// The crawler stores the wire form, because that is what `Url::parse` produces
// and what every table join, dedup key and sort comparator matches on. Changing
// what is stored would break those; the readable form is derived here instead,
// at the point of display.

/**
 * The readable form: percent-escapes turned back into their characters, so a
 * Persian path reads as `/mag/سئو-چیست/` rather than as forty hex digits.
 *
 * `decodeURI` deliberately leaves the structural characters (`?`, `#`, `/`,
 * `&`) escaped — decoding those would change what the URL means, not just how
 * it looks. A malformed escape makes it throw, and then the raw string is
 * already the most honest thing to show.
 */
export function displayAddress(url: unknown): string {
  const raw = url === null || url === undefined ? "" : String(url);
  if (!raw.includes("%")) return raw;
  try {
    return decodeURI(raw);
  } catch {
    return raw;
  }
}

/**
 * The wire form. Encoding the stored address directly is the bug this replaces:
 * it is *already* encoded, so `encodeURI` only escaped every `%` into `%25` and
 * produced a URL that resolves to nothing. Decoding first makes the round trip
 * idempotent, and covers the case where the address still holds raw Unicode.
 */
export function encodedAddress(url: unknown): string {
  const raw = url === null || url === undefined ? "" : String(url);
  if (!raw) return "";
  try {
    return encodeURI(decodeURI(raw));
  } catch {
    return raw;
  }
}
