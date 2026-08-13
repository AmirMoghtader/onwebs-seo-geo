# Changelog

## 0.1.1 — 2026-08-14

Reliability release. A crawl of a slow Persian host (838 URLs) went from dying
at 0% to finishing completely, and several columns that had been silently empty
or wrong now carry real numbers.

### Crawl reliability
- **robots.txt no longer kills a crawl it cannot reach.** A transport failure
  (DNS, TLS, timeout, VPN) was treated as a server error, memoised for the
  whole crawl, and read as a site-wide ban. RFC 9309's hold-off rule applies to
  a server answering badly, not to us failing to connect. Transport errors now
  retry three times with backoff and then continue without robots rules
- Default concurrency lowered from 16 to 6; a slow host collapsed under the
  wider fan-out and returned timeouts that were recorded as permanent failures
- Response bodies are retried on a truncated read. The request had retries and
  the body read had none, so one connection closed mid-response burned the URL
- Inline `data:` images are no longer fetched — 324 guaranteed failures per crawl
- Dead external links log at debug, not error; they are a finding, not a fault

### Data correctness
- `Size` was reading a key the crawler never writes and was blank on every row
  of every crawl. `Transferred` was filled with the *decompressed* length,
  making it equal `Size` on 821 of 838 pages. Compressed bodies are now decoded
  by hand so the wire size is measured: 284,955 raw vs 34,191 gzipped
- Outlinks disagreed between the table and the details drawer because they read
  different records; both now read one calculation
- Inlinks are computed by inverting the whole link graph in SQLite — the table
  had no data to invert and reported 0, the drawer read a field nothing wrote
- Flesch Reading Ease is left blank for non-English text instead of reporting a
  number produced by counting English vowels in Persian prose
- Persian URLs display decoded and encode exactly once
- JavaScript files were gated behind the Headless Chrome switch, so a crawl that
  found every image and stylesheet reported zero scripts

### Interface
- shadcn colour tokens were defined but never mapped into Tailwind, so every
  popover, dialog and dropdown rendered with no background
- URL details pane reads as a two-column list again; the app-wide right
  alignment had stranded each value at the far edge, away from its label
- Failed URLs are clickable from the status bar, selectable with click,
  Cmd-click and Shift-click, and retryable from the right-click menu
- `Clear` empties the results without restarting the app
- Forms are recorded with their action, path type and whether they post insecurely


## 0.1.0 — 2026-08-12

First release of **Onwebs SEO & GEO**, forked from RustySEO 0.4.0 (GPL-3.0).

### Screaming Frog parity
- Internal tab with all **73 Screaming Frog columns**, unified pages+assets view, content-type filter tabs, column picker (persisted), full CSV export
- Three-state click-to-sort on every column in every table; Persian-aware collation; blanks sink
- Redirect chains rendered as separate rows with their real 3xx status codes
- New extractions: meta keywords, meta refresh, mobile alternate link, X-Robots-Tag, Link headers (rel=next/prev), Last-Modified, HTTP version, transferred bytes, MD5 hash, crawl timestamp, rel=next/prev/amphtml selectors
- Sentence count & readability matching Screaming Frog's numbers exactly (verified on live crawls)
- Include/Exclude URL patterns and List mode
- Crawl pause/stop that actually cancels in-flight requests (was: up to 5 retries × 60 s per URL after pressing stop)
- Save/Open crawl files; crawl diff checker

### Speed
- Crawl defaults rewritten: 16 concurrent requests (was 5), zero base delay (was 1.5 s per request), 20 s timeout (was 60), 2 retries (was 5) — roughly 10× faster on your own sites, with adaptive backoff kept for 429/503
- New **Speed** section in settings with one-click profiles: Polite / Balanced / Fast

### Branding & UI
- Renamed to Onwebs SEO & GEO with the Onwebs mark (app icon, favicon, splash)
- Full Persian localisation (RTL text, LTR structure, technical terms in English); English mode fixed
- Native macOS menu bar (File/View/Configuration/Export/Tools/Help) with crawl shortcuts ⌘↩ / ⌘P / ⌘.
- In-app menubar and changelog popup removed; top bar pinned to the window edge
- Deterministic layout spacer (identical WebKit/Chromium rendering); fixed content sliding under the top bar on every page
- Shallow-crawler dashboard: 14 widgets in two rows of seven, compact
- Window no longer overflows small laptop screens

### Privacy & code health
- Removed third-party community chat, suggestion box POST, and remote update checks
- Stripped hardcoded Google API keys from the crawler sources
- Zero Next.js console/hydration errors across all routes; Tauri API browser shim for clean web preview
