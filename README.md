<div align="center">

<img src="public/icon.png" alt="Onwebs SEO & GEO" width="96" />

# Onwebs SEO & GEO

**The complete, free, open-source alternative to Screaming Frog SEO Spider — plus GEO (AI search) tooling it doesn't have.**

[دانلود و مستندات فارسی ← README.fa.md](README.fa.md) · [seo.onwebs.ir](https://seo.onwebs.ir) · [Downloads](../../releases)

![Version](https://img.shields.io/badge/version-0.1.0-1E3A6F)
![License](https://img.shields.io/badge/license-GPL--3.0-blue)
![Platforms](https://img.shields.io/badge/platforms-macOS%20·%20Windows%20·%20Linux-2B6CC4)
![Privacy](https://img.shields.io/badge/telemetry-none-brightgreen)

</div>

---

## Why this instead of Screaming Frog?

| | **Onwebs SEO & GEO** | Screaming Frog SEO Spider |
|---|---|---|
| Price | **Free, forever** | £259/year for full features |
| Crawl limit | **Unlimited** | 500 URLs on the free tier |
| Source code | **Open (GPL-3)** | Closed |
| Internal tab | **73 columns — full parity** | 73 columns |
| Redirect chains as rows | ✅ | ✅ |
| Include/Exclude, List mode | ✅ | ✅ |
| Crawl speed control | ✅ 3 one-click profiles | ✅ |
| Log file analyser | ✅ **Built in, with AI-bot tracking** | Separate paid product |
| GEO / AI search readiness | ✅ GPTBot, ClaudeBot, PerplexityBot tracking | ❌ |
| PageSpeed, GA4, GSC, Clarity connectors | ✅ | Partly (paid) |
| Google Ads simulator, image converter | ✅ | ❌ |
| Persian (فارسی) UI | ✅ First-class | ❌ |
| Telemetry | **None — your data never leaves your machine** | — |

Desktop crawler built with **Rust** (fast, low memory) and **Next.js**, packaged with **Tauri** — the whole app is ~25 MB and idles at ~57 MB RAM.

## Features

- **Deep crawler** with Screaming Frog's exact Internal-tab column set (all 73 columns), unified view of pages + images + JS + CSS, content-type filter tabs, column picker, full CSV export
- **Three-state click-to-sort on every column**, blanks always last, Persian-aware collation
- **Redirect chains** rendered as separate rows with real 3xx status codes
- **Crawl speed profiles**: Polite / Balanced / Fast (up to 16 concurrent requests, zero delay on your own sites, adaptive backoff on 429/503)
- **Shallow crawler** for single-page audits: Core Web Vitals, head analysis, OpenGraph/SERP previews, readability, keyword density
- **Issues explorer** sorted by severity, overview pane with clickable buckets
- **XML sitemap analysis**, robots.txt inspection, orphan-page detection
- **Log file analyser** with indexing-bot, retrieval-agent and agentic-AI-bot breakdowns (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, …)
- **Connectors**: PageSpeed Insights, Google Analytics 4, Search Console, Microsoft Clarity, Power BI, Ollama & Gemini (local AI analysis)
- **Reports**: full crawl PDF, server-log PDF, Screaming-Frog-style CSV report slices, bulk export
- **Save/Open crawls** as files; crawl history with diff checker
- **Native macOS menu bar** with crawl shortcuts (⌘↩ start, ⌘P pause, ⌘. stop)
- **Persian-first bilingual UI** (English available), RTL text with LTR layout

## Privacy

No telemetry, no analytics, no phone-home. The community chat, suggestion box and remote update checks present in upstream were **removed** in this fork after a security audit. Crawl data lives in a local database on your machine.

## Downloads

Grab the installer for your OS from **[Releases](../../releases)**:

| OS | File |
|---|---|
| macOS (Apple Silicon) | `*_aarch64.dmg` |
| macOS (Intel) | `*_x64.dmg` |
| Windows 10/11 | `*_x64-setup.exe` / `*.msi` |
| Linux (Debian/Ubuntu) | `*.deb` |
| Linux (Fedora/RHEL) | `*.rpm` |
| Linux (portable) | `*.AppImage` |

More at **[seo.onwebs.ir](https://seo.onwebs.ir)**.

## Build from source

```bash
git clone https://github.com/AmirMoghtader/onwebs-seo-geo
cd onwebs-seo-geo
npm install
npx tauri build   # needs Rust + platform toolchain
```

## Based on RustySEO

This project is a fork of [RustySEO](https://github.com/mascanho/RustySEO) by mascanho, licensed under GPL-3.0 — the same license this repository keeps. Beyond rebranding, this fork adds (highlights):

- Full Screaming Frog Internal-tab **column parity (73 columns)** with a unified pages+assets view, column picker and complete CSV export
- Click-to-sort on every table, redirect-hop rows, inlink tallies
- New crawler extractions: meta keywords, X-Robots-Tag, Link headers (rel=next/prev), HTTP version, transferred bytes, MD5 hash, crawl timestamps, sentence counts matching Screaming Frog's numbers exactly
- Include/Exclude patterns, List mode, working pause/stop that cancels in-flight requests
- Crawl speed profiles and a rewritten defaults set (~10× faster on your own sites)
- Native macOS menu bar, window sizing fixes, compact dashboard
- Persian localisation of the entire UI
- Privacy hardening: third-party chat/suggestion/update endpoints removed, hardcoded API keys stripped
- Hydration/console-error cleanup across every route

## License

[GPL-3.0](LICENSE) — free as in freedom. Keywords: *screaming frog alternative, free seo spider, site crawler, technical seo audit, seo tools, GEO, AI search optimization, log file analyser, رایگان, سئو*.
