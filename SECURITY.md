# Security & Privacy Policy

## Privacy by default

Onwebs SEO & GEO is a desktop application. **Your crawl data never leaves your machine.**

- No telemetry, no analytics, no crash reporting.
- Crawl results are stored in a local database under your OS's application-support directory.
- The only outbound network traffic is what you explicitly trigger: crawling the sites you enter, and the connectors you configure yourself (PageSpeed Insights, GA4, Search Console, Microsoft Clarity, Ollama/Gemini).
- The community chat, suggestion box and remote update checker present in upstream RustySEO were removed from this fork after a security review.
- No API keys ship with the app. Keys you add via *Connectors* are stored locally in `api_keys.toml` inside your profile directory and are excluded from crawl exports.

نسخه‌ی فارسی: این برنامه هیچ داده‌ای را به هیچ سروری ارسال نمی‌کند. تنها ترافیک شبکه، کراول سایت‌هایی است که خودتان وارد می‌کنید و اتصال‌هایی که خودتان پیکربندی می‌کنید. کلیدهای API فقط به‌صورت لوکال ذخیره می‌شوند.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅ |

## Reporting a vulnerability

Open a [GitHub issue](../../issues) with the `security` label, or email **ftsepi@gmail.com**. Please include steps to reproduce. You can expect a first response within a week.
