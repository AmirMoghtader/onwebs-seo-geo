# Changelog

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
