# کارهای باقی‌مانده — Onwebs SEO & GEO

> این فایل وضعیت پروژه و هر کاری که تمام نشده را نگه می‌دارد.
> آخرین به‌روزرسانی: پس از افزودن تب Internal یکپارچه، سورت ستون‌ها، و کشوی جزئیات برنامه اقدام.

---

## ۱. کارهای تمام‌شده (برای مرجع)

| کار | توضیح |
|---|---|
| باگ اندازه پنجره | `minWidth` از ۱۶۰۰ به ۹۰۰ رسید؛ صفحه‌ی مک‌بوک ۱۴۴۰×۹۰۰ است و پنجره اصلاً جا نمی‌شد |
| حذف تله‌متری | ارسال UUID به `api.rustyseo.com`، چک آپدیت GitHub، چت Supabase، فرم پیشنهاد، favicon گوگل، فونت گوگل، تصویر hero از GitHub — همه حذف شدند |
| سخت‌سازی امنیتی | CSP از `null` به allowlist؛ `shell:allow-execute` حذف شد |
| تغییر نام | `Onwebs SEO & GEO` در همه‌جا + bundle id `com.onwebs.seogeo` |
| لوگو | wordmark آنوبیس ساخته شد (`public/onwebs-wordmark.png`)، آیکون‌های اپ بازتولید شدند |
| فونت فارسی | IRANSansX لوکال، وصل به Tailwind و تم Mantine |
| فارسی‌سازی | ۲۳۷۴ رشته در ۲۰۰+ فایل |
| راست‌چینی | متن راست‌چین با `unicode-bidi: plaintext`؛ URL و کد عمداً LTR |
| سورت ستون‌ها | هر ۱۰ جدول: نزولی ← صعودی ← بدون سورت |
| کاوشگر مشکلات | مرتب‌سازی بر اساس شدت (High → Medium → Low) |
| کاشی‌های نمای کلی | کلیک‌پذیر + کاشی 3XX اضافه شد + فیلتر جدول |
| تب Internal | یکپارچه با dropdown فیلتر، دیفالت |
| کشوی برنامه اقدام | توضیح کامل + فهرست URLهای درگیر |

---

## ۲. کار نیمه‌تمام — همین الان دست‌نخورده مانده

**هیچ کار نیمه‌تمامی باقی نمانده.** بخش بررسی سایت‌مپ تمام شد:
- ✅ Rust: رویداد `sitemap_urls` در `src-tauri/src/domain_crawler/domain_crawler.rs`
- ✅ UI: `app/global/_components/Sidebar/BottomContainer/SitemapReview.tsx`
- ✅ mount شد: تب «سایت‌مپ» در `BottomContainer.tsx` (قبلاً کامنت بود)
- ✅ بیلد Rust و نصب انجام شد

پنج دسته‌ای که محاسبه می‌کند: در سایت‌مپ و کراول‌شده / در سایت‌مپ ولی کراول نشده (orphan) / کراول‌شده ولی در سایت‌مپ نیست / غیرقابل ایندکس در سایت‌مپ / خطادار در سایت‌مپ.

## ۳. محدودیت‌های شناخته‌شده

| مورد | توضیح |
|---|---|
| Status Code و Size برای asset‌ها | در تب Internal خالی می‌ماند. کراولر برای تصاویر/JS/CSS درخواست جدا نمی‌زند، فقط آدرس را از HTML استخراج می‌کند. اسکریمینگ فراگ تک‌تک را fetch می‌کند → نیاز به تغییر Rust |
| بازطراحی UI بر اساس onwebs.ir | سایت از این شبکه در دسترس نیست (تست شد: digikala و aparat باز می‌شوند، onwebs.ir نه). نیاز به اسکرین‌شات یا مشخصات رنگ/فونت |
| دقت کراول | بررسی شد و مشکلی ندارد: ۱۲۹ صفحه‌ی ما در برابر ۱۲۵ صفحه‌ی HTML اسکریمینگ فراگ. اختلاف ۲۲۸ به‌خاطر این بود که SF تصاویر/JS/CSS را هم در همان جدول می‌شمارد |

---

## ۴. شکاف با اسکریمینگ فراگ — ۱۲۴ مورد

از خواندن راهنمای رسمی و مقایسه با کد. مرتب‌شده بر اساس ارزش، سپس حجم کار.

| قابلیت | وضعیت | ارزش | حجم |
|---|---|---|---|
| User-Agent configuration (HTTP Request UA + separate robots UA, presets, custo | ندارد | critical | small |
| Crawl Depth (col 42) | ندارد | critical | small |
| Page Titles tab + 9 filters | نیمه‌کاره | critical | small |
| Meta Description tab + 8 filters | نیمه‌کاره | critical | small |
| Include / Exclude (regex URL filters to scope a crawl) | ندارد | critical | medium |
| robots.txt handling (Respect / Ignore / Ignore-but-report, custom robots.txt e | نیمه‌کاره | critical | medium |
| Inlinks + Unique Inlinks (cols 45-46) | نیمه‌کاره | critical | medium |
| Crawl Analysis engine (post-crawl pass + Auto Analyse At End of Crawl) | نیمه‌کاره | critical | medium |
| Per-tab filter dropdown (the core SF interaction model) | ندارد | critical | medium |
| Internal tab (SF default tab) + Content Type filter | نیمه‌کاره | critical | medium |
| Response Codes tab + 12 filters | نیمه‌کاره | critical | medium |
| Clickable overview counts that drive the table | ندارد | critical | medium |
| List mode (crawl an uploaded/pasted list of URLs) | ندارد | critical | medium |
| JavaScript rendering configuration (AJAX timeout, window size, JS errors, bloc | نیمه‌کاره | critical | medium |
| Custom Extraction (XPath / CSSPath / Regex extractors that add new data column | ندارد | critical | large |
| Reports menu (top-level, ~30 named reports) | ندارد | critical | large |
| Bulk Export menu (entire menu) | ندارد | critical | large |
| Crawl Analysis post-processing pass | ندارد | critical | large |
| Persistent crawl storage — save / open / manage crawls (File > Crawls) | ندارد | critical | large |
| HTTP Header configuration (arbitrary custom request headers) | ندارد | high | small |
| GeneralSettings.tsx is a dead static mockup that advertises config we do not h | ندارد | high | small |
| Status (col 4 — HTTP reason phrase) | ندارد | high | small |
| X-Robots-Tag 1 (col 23) | نیمه‌کاره | high | small |
| Outlinks + Unique Outlinks (cols 49-50) | نیمه‌کاره | high | small |
| External Outlinks + Unique External Outlinks (cols 52-53) | نیمه‌کاره | high | small |
| Insecure Content report | نیمه‌کاره | high | small |
| Bulk Export > Issues (each issue as its own spreadsheet) | نیمه‌کاره | high | small |
| Link Score parity (Internal-tab column, manual re-run, 0-100 semantics) | نیمه‌کاره | high | small |
| H1 tab (6 filters) and H2 tab (5 filters) | نیمه‌کاره | high | small |
| Crawl configuration save / load (named .seospiderconfig profiles, Save As, Loa | ندارد | high | medium |
| Spider Configuration > Limits tab | نیمه‌کاره | high | medium |
| Authentication (standards-based Basic/Digest and forms-based login) | ندارد | high | medium |
| Spider Configuration > Preferences tab (all SEO thresholds user-tunable) | ندارد | high | medium |
| Speed configuration (Max Threads + Max URLs/second) | نیمه‌کاره | high | medium |
| Indexability Status (col 6) | نیمه‌کاره | high | medium |
| Title 1 Pixel Width (col 9) | ندارد | high | medium |
| Closest Near Duplicate Match + No. Near Duplicates (cols 55-56) | نیمه‌کاره | high | medium |
| Pagination (rel=next / rel=prev) extraction and all Pagination reports | ندارد | high | medium |
| Redirect Chains / Redirect & Canonical Chains / Redirects to Errors reports | نیمه‌کاره | high | medium |
| Canonical Chains + Non-Indexable Canonicals reports | نیمه‌کاره | high | medium |
| Orphan Pages report (GA + GSC + XML Sitemap vs crawl) | نیمه‌کاره | high | medium |
| Sitemaps tab + sitemap crawl-analysis filters | ندارد | high | medium |
| Crawl Overview report (exportable per-tab/per-filter summary) | نیمه‌کاره | high | medium |
| All Inlinks / All Outlinks / All Anchor Text bulk exports | نیمه‌کاره | high | medium |
| Canonicals tab + 12 filters | نیمه‌کاره | high | medium |
| Directives tab + 17 filters | نیمه‌کاره | high | medium |
| Images tab + 7 filters | نیمه‌کاره | high | medium |
| Links tab + 12 filters | نیمه‌کاره | high | medium |
| Security tab + 13 filters | نیمه‌کاره | high | medium |
| Sitemaps tab + 6 filters (requires Crawl Analysis) | ندارد | high | medium |
| XML sitemap generation | ندارد | high | medium |
| Crawl resume across app restarts | نیمه‌کاره | high | medium |
| Google Search Console integration as crawl columns / GSC tab | نیمه‌کاره | high | medium |
| Google Analytics (GA4) integration as crawl columns / Analytics tab | نیمه‌کاره | high | medium |
| Spider Configuration > Crawl tab (per-resource-type Store/Crawl checkboxes and | ندارد | high | large |
| Spider Configuration > Advanced tab (respect/always-follow directives, cookie  | ندارد | high | large |
| Spider Configuration > Rendering tab (Text Only / Old AJAX / JavaScript mode,  | نیمه‌کاره | high | large |
| Hreflang validation + the 7 Hreflang reports | نیمه‌کاره | high | large |
| Structured Data validation (Schema.org + Google Rich Results) and its 4 report | ندارد | high | large |
| Hreflang tab + 14 filters | نیمه‌کاره | high | large |
| Content tab + 11 filters | نیمه‌کاره | high | large |
| Search Console tab + filters (GSC + URL Inspection) | نیمه‌کاره | high | large |
| Compare mode (crawl comparison, change detection, URL mapping) | نیمه‌کاره | high | large |
| Scheduling (recurring/one-off scheduled crawls with auto-export) | ندارد | high | large |
| Custom Search (find/exclude text, HTML, elements, XPath across pages) | نیمه‌کاره | medium | small |
| Content > Duplicates settings (near-duplicate threshold, indexable-only) | نیمه‌کاره | medium | small |
| Proxy configuration | ندارد | medium | small |
| CDNs configuration (treat listed external domains as internal) | ندارد | medium | small |
| H2-2 + H2-2 Length (cols 19-20) | نیمه‌کاره | medium | small |
| Meta Robots 2 (col 22) | نیمه‌کاره | medium | small |
| Meta Refresh 1 (col 24) | ندارد | medium | small |
| % of Total (col 48) | ندارد | medium | small |
| Hash (col 59) | نیمه‌کاره | medium | small |
| Last Modified (col 61) | نیمه‌کاره | medium | small |
| HTTP Header Summary + Cookie Summary aggregated reports | نیمه‌کاره | medium | small |
| SERP Summary report (title/description char length AND pixel width) | نیمه‌کاره | medium | small |
| Near Duplicates / duplicate content (crawl-analysis item) | نیمه‌کاره | medium | small |
| URL tab + 11 filters | نیمه‌کاره | medium | small |
| Image sitemap generation | ندارد | medium | small |
| Content > Area (which page regions count as content) | ندارد | medium | medium |
| URL Rewriting (remove parameters, regex replace, lowercase, percent-encoding) | ندارد | medium | medium |
| Settings information architecture: engine internals exposed, SEO config absent | نیمه‌کاره | medium | medium |
| Spider Configuration > Extraction tab (toggle what gets stored) | ندارد | medium | medium |
| Custom Link Positions | ندارد | medium | medium |
| Meta Description 1 Pixel Width (col 12) | ندارد | medium | medium |
| PageSpeed Opportunities Summary + CSS/JavaScript Coverage Summary reports | نیمه‌کاره | medium | medium |
| Crawl Path Report (shortest discovery path to a URL) | ندارد | medium | medium |
| Bulk Export > Web (Page Source, Page Text, PDFs, Screenshots, Archived Website | نیمه‌کاره | medium | medium |
| Bulk Export > Links quality slices (nofollow, no anchor text, non-descriptive  | ندارد | medium | medium |
| Export formats: Google Sheets, Excel 97-2004, Looker Studio, Multi-Export | نیمه‌کاره | medium | medium |
| External tab + content-type filters | نیمه‌کاره | medium | medium |
| Pagination tab + 10 filters | ندارد | medium | medium |
| PageSpeed tab + ~19 opportunity filters | نیمه‌کاره | medium | medium |
| Custom Extraction tab | نیمه‌کاره | medium | medium |
| Crawl tree graph / directory tree graph visualisations | نیمه‌کاره | medium | medium |
| Force-directed crawl & directory diagrams (node scaling, colouring, focus, exp | نیمه‌کاره | medium | medium |
| Segments | ندارد | medium | large |
| JavaScript tab + 16 filters | ندارد | medium | large |
| Structured Data tab + 6 filters | نیمه‌کاره | medium | large |
| Analytics tab + 5 filters (GA4 integration) | ندارد | medium | large |
| Command line interface / headless execution | ندارد | medium | large |
| Meta Keywords 1 + Length (cols 13-14) | ندارد | low | small |
| rel="next" / rel="prev", HTML and HTTP (cols 26-29) | ندارد | low | small |
| amphtml Link Element (col 30) | ندارد | low | small |
| CO2 (mg) + Carbon Rating (cols 34-35) | ندارد | low | small |
| Sentence Count + Average Words Per Sentence (cols 37-38) | ندارد | low | small |
| HTTP Version (col 66) | ندارد | low | small |
| Mobile Alternate Link (col 67) | ندارد | low | small |
| URL Encoded Address (col 72) | ندارد | low | small |
| Crawl Timestamp (col 73) | نیمه‌کاره | low | small |
| Meta Keywords tab + 3 filters | ندارد | low | small |
| Word cloud visualisations (body text / anchor text) | ندارد | low | small |
| System settings (memory allocation, storage mode RAM vs Database, trusted cert | نیمه‌کاره | low | medium |
| Transferred (Bytes) + Total Transferred (Bytes) (cols 32-33) | ندارد | low | medium |
| SERP mode (upload titles/descriptions, pixel-width preview) | ندارد | low | medium |
| Third-party link-metric APIs (Majestic, Ahrefs, Moz) | ندارد | low | medium |
| Content > Spelling & Grammar | ندارد | low | large |
| Custom JavaScript snippets | ندارد | low | large |
| Unique JS Inlinks / Unique JS Outlinks / Unique External JS Outlinks (cols 47, | ندارد | low | large |
| Spelling Errors + Grammar Errors (cols 57-58) | ندارد | low | large |
| Closest Semantically Similar Address / Semantic Similarity Score / No. Semanti | ندارد | low | large |
| Accessibility violations report + AMP reports + Chrome Console Log Summary | ندارد | low | large |
| AMP tab + 16 filters | ندارد | low | large |
| Validation, Mobile and Accessibility tabs (bonus tabs beyond the requested lis | ندارد | low | large |

---

## ۵-الف. انجام‌شده در دورهای اخیر

- سورت کلیک‌شونده روی هر ۱۰ جدول (نزولی ← صعودی ← بدون سورت)
- تب Internal یکپارچه، دیفالت، با dropdown نوع محتوا و ۱۷ ستون
- حذف تب‌های تکراری HTML / CSS / Javascript (حالا فیلتر داخل Internal‌اند)
- ستون `Status` (متن HTTP) اضافه شد
- ۹ تب فیلتردار SF: Page Titles, Meta Description, H1, H2, Response Codes, Canonicals, Directives, Security, Content
- جابه‌جایی تب‌ها با کشیدن (pointer events — چون WebKit روی `<button>` درگ نیتیو ندارد)، ترتیب در localStorage
- پنل راست: تب `Overview` با درخت Summary + Crawl Data، کلیک‌شونده به فیلتر جدول
- پنل راست: تب `Issues` به سبک SF با Description و How To Fix و فهرست آدرس‌ها؛ کلیک، جدول را فیلتر می‌کند
- کاشی‌های نمای کلی کلیک‌پذیر + کاشی 3XX
- کشوی جزئیات برنامه اقدام با فهرست URLهای درگیر
- بخش بررسی سایت‌مپ (۵ دسته، شامل orphan)
- Export در تب Internal (با BOM برای اکسل)
- رفع باگ: کلیک روی asset در تب Internal حالا جزئیات خودش را نشان می‌دهد (asset‌ها در `domain_crawl` نیستند)

- پنل `URL Details` عمودی Name/Value با ~۵۰ فیلد و شمارنده‌ی `Total:` (به‌جای جدول افقی ۹۳۶ خطی قبلی)
- محاسبه‌ی **Pixel Width** با `canvas.measureText` در Arial 20px/14px — درست برای فارسی، نه تقریب از روی طول کاراکتر
- تب `SERP Snippet` با پیش‌نمایش زنده‌ی گوگل و جدول Chars/Pixels (Length/Displayed/Truncated + Length/Available/Remaining)، فیلدهای قابل ویرایش، Device و Description Prefix
- تب `Site Structure` با درخت مسیرها + نمودار Crawl Depth رنگ‌بندی‌شده
- منوی `Reports` با ۱۰ گزارش CSV: Crawl Overview, Redirects, Insecure Content, Orphan Pages, Duplicate Titles, Duplicate Descriptions, Canonical Errors, SERP Summary, Non-Indexable URLs, Response Codes

- **Include / Exclude واقعی** — ماژول Rust `helpers/url_filters.rs` با ۵ تست واحد، در هر دو نقطه‌ی ورود URL اعمال می‌شود (سایت‌مپ + لینک‌های کشف‌شده). Exclude بر Include اولویت دارد. regex نامعتبر نادیده گرفته می‌شود نه اینکه کراول را بکشد. regexها کش می‌شوند.
- پنجره‌ی `Crawl Config` دو ستونه با Include / Exclude / User-Agent / Speed، اعتبارسنجی زنده‌ی regex و `Valid config` — واقعاً از طریق `update_settings_command` ذخیره می‌شود
- منوی `Bulk Export` با ۸ دسته و ۲۰ خروجی CSV (Links, Response Codes, Content, Images, Directives, Canonicals, Security, Web)

### یافته‌ی مهم
`Custom Search` موجود از قبل **CSS Selector + Regex** با انتخاب Text/HTML/Attribute دارد — یعنی عملاً همان `Custom Extraction` اسکریمینگ فراگ است. تنها کمبودش **XPath** است. نیازی به ساخت از صفر نیست، فقط باید XPath به `SearchMode` اضافه شود.

- منوی `Bulk Export` با ۸ دسته و ۱۸ خروجی CSV (Links، Response Codes، Content، Images، Directives، Canonicals، Security، Web)
- `File > Open Crawl…` و `Save Crawl…` — کراول در فایل `.onwebscrawl` ذخیره و بازخوانی می‌شود (دیتابیس فقط آخرین کراول را نگه می‌دارد)
- ۴ تب جدید: `URL` (Non-ASCII، Underscores، Uppercase، Parameters، Over 115…)، `Hreflang` (شامل Missing Self Reference و Missing x-default)، `Structured Data`، `Images` (Missing Alt Text)
- استخراج `rel=next` / `rel=prev` / `rel=amphtml` در Rust (`helpers/pagination_selector.rs` با تست) → تب‌های `Pagination` و `AMP`
- `check_assets_command` در Rust — Status Code و Size برای تصاویر/JS/CSS در تب Internal (قبلاً همیشه خالی بود)
- **کشف:** `Custom Search` موجود از قبل CSS Selector + Regex با انتخاب Text/HTML/Attribute دارد؛ یعنی عملاً `Custom Extraction` است و فقط **XPath** کم دارد

- **حذف ماکت مرده‌ی تنظیمات**: `GeneralSettings.tsx` (۹۲۷ خط، صفر `invoke`، صفر `onChange`) پاک شد و تب تنظیمات حالا `CrawlConfig` واقعی را نشان می‌دهد که با `get_settings_command`/`update_settings_command` کار می‌کند
- Include / Exclude با regex: هم در `Settings` ذخیره می‌شود، هم کراولر از طریق `UrlFilters` واقعاً اعمالش می‌کند

- **List mode** (Mode > List در SF): فقط آدرس‌های داده‌شده کراول می‌شوند، هیچ لینکی دنبال نمی‌شود، سایت‌مپ هم خوانده نمی‌شود. `list_mode` + `list_urls` در Settings، seed در `domain_crawler.rs`، و گیت کشف در `url_processor.rs`. بخش «Mode» در پنل تنظیمات

## ۵. ترتیب پیشنهادی ادامه‌ی کار

1. **mount کردن `SitemapReview`** + بیلد Rust — نیمه‌کاره است
2. **فیلتر dropdown برای هر تب** — مدل تعاملی اصلی اسکریمینگ فراگ؛ بدون این بقیه‌ی تب‌ها ناقص‌اند
3. **ستون `Status`** (متن HTTP: OK / Not Found / …) — کوچک، از `status_code` مشتق می‌شود
4. **تنظیمات User-Agent** — کوچک، ولی `GeneralSettings` باید واقعی شود
5. **Include / Exclude با regex** — برای محدود کردن دامنه‌ی کراول
6. **ستون‌های Inlinks / Unique Inlinks / Outlinks** — داده‌اش تا حدی هست
7. **Title / Description Pixel Width** — نیاز به جدول عرض کاراکتر یا `canvas.measureText`
8. **Custom Extraction** (XPath / CSSPath / Regex) — بزرگ
9. **منوی Reports و Bulk Export** — بزرگ
10. **ذخیره/بازکردن کراول** (`File > Crawls`) — بزرگ
11. **List mode** — کراول یک فهرست URL به‌جای کراول دامنه

---

## ۶. یادداشت‌های فنی برای آینده

- **سورت جدول‌ها:** هر جدول یک `getRowValues(row, index)` در `tableLayout.ts` کنارش دارد. هوک مشترک `components/useTableSort.ts` است. سلول‌های خالی همیشه ته لیست می‌روند، مقایسه‌ی عددی از متنی جداست.
- **کلیک روی هدر = سورت، دوبار کلیک = تغییر چیدمان ستون.** کلیک تکی قبلاً مال چیدمان بود.
- **`tableFilter` در store:** کاشی‌های نمای کلی این را ست می‌کنند و `TableCrawl` بر اساسش فیلتر و سورت می‌کند.
- **راست‌چینی:** ریشه‌ی تمام باگ‌های آیکون این بود که `unicode-bidi: plaintext` روی span، جهت خط را از اولین حرف فارسی می‌گرفت و آیکون را می‌انداخت آخر. داخل دکمه‌ها و تب‌ها خنثی شده.
- **letter-spacing:** کلاس‌های `tracking-*` اتصال حروف فارسی را می‌شکنند؛ سراسری خنثی شده‌اند.
- **ایجنت‌های موازی:** برای کارهای فقط-خواندنی حتماً `agentType: 'Explore'` بدهید. یک بار یک ایجنت خروجی‌اش را روی `app/layout.tsx` نوشت و فایل را خراب کرد.
- **پروژه GPL-3 است.** استفاده‌ی شخصی و تغییر آزاد است؛ لینک‌های attribution پروژه‌ی اصلی عمداً نگه داشته شده‌اند.

---

## ۷. مشخصات دقیق UX اسکریمینگ فراگ (از ۱۱ اسکرین‌شات، ۲۴.۳)

مرجع قطعی برای بازسازی. هرچه اینجا نوشته شده از روی تصویر واقعی است نه حدس.

### چیدمان کلی
```
┌ منوی اصلی: File │ View │ Mode │ Configuration │ Bulk Export │ Reports │
│               Sitemaps │ Visualisations │ Crawl Analysis │ MCP │ Licence │ Window │ Help
├ نوار آدرس: [🌐 URL] [✕] [▾] │ [All Subdomains ▾] │ [▶ Start] │ [Clear] │ [Crawl 100%] │ SEO Spider
├──────────────────────────────────┬──────────────────────────────
│ تب‌ها (اسکرول‌شونده، با ▾ سرریز)   │ Overview │ Issues │ Site Structure │ Segments │ Response…
│ [▼ فیلتر] [☰|🌲] [⬆ Export] [🔍]  │
│ جدول اصلی                         │ پنل راست
├──────────────────────────────────┤
│ Selected Cells: N  Filter Total: N│
├──────────────────────────────────┤
│ تب‌های پایین (جزئیات URL انتخاب‌شده)│
└ Spider Mode: Idle │ Average: N URL/s │ Completed N of N (100%)
```

**نکته‌ی مهم از کاربر:** تب‌های پایین این‌طور کار می‌کنند که **اول یک URL از جدول بالا انتخاب می‌شود، بعد یکی از تب‌های پایین**. یعنی پنل پایین همیشه در بافت URL انتخاب‌شده است.

### تب‌های اصلی (به ترتیب)
`Internal` `External` `Security` `Response Codes` `URL` `Page Titles` `Meta Description` `Meta Keywords` `H1` `H2` `Content` `Images` `Canonicals` `Pagination` `Directives` `Hreflang` `JavaScript` `Links` `AMP` `Structured Data` `Sitemaps` `PageSpeed` `Mobile` `Accessibility` `Custom Search` `Custom Extraction` `Custom JavaScript` `Analytics` `Search Console` `Validation` `Response Times` `API` `Spelling & Grammar` `Semantic Search`

### تب‌های پایین
`URL Details` `Inlinks` `Outlinks` `Image Details` `Resources` `SERP Snippet` `Rendered Page` `Chrome Console Log` `View Source` `HTTP Headers` `Cookies` `Duplicate Details` `Structured Data`

- **URL Details** — جدول Name/Value، `Total: 73` (این همان ۷۳ فیلد است، نه ۷۳ ستون افقی)
- **Inlinks / Outlinks** — نوار ابزار: `All Link Types ▾` `All Link Origin Types ▾` `Show Links (5/5) ▾` `All Links ▾` `⬆ Export` `🔍`. ستون‌ها: `Type │ From │ To`
- **SERP Snippet** — پیش‌نمایش زنده‌ی گوگل + جدول:
  | Element | Chars: Length / Displayed / Truncated | Pixels: Length / Available / Remaining |
  مثال واقعی: Title 72/67/**5** و 588/561/**-27** (قرمز یعنی سرریز) — Description 148/148/0 و 783/985/**202** (سبز)
  زیرش فیلدهای قابل ویرایش Title و Description، `Device ▾`، `Site Name`، `Keywords`، `Description Prefix ▾`، `Rich Snippet ▾` + ستاره، `Revert Changes`

### پنل راست — Overview
درخت دوسطحی با ستون‌های `URLs` و `% of Total`:
```
▼ Summary
    Total URLs Encountered              254   100%
    Total Internal Blocked by robots.txt  0     0%
    Total External Blocked by robots.txt  0     0%
    Total URLs Crawled                  254   100%
    Total Internal URLs                 228   89.76%
    Total External URLs                  26   10.24%
    Total Internal Indexable URLs       195   85.53%
    Total Internal Non-Indexable URLs    33   14.47%
▼ Crawl Data
  ▼ Internal
      All 228 100% │ HTML 126 55.26% │ JavaScript 23 10.09% │ CSS 8 3.51%
      Images 65 28.51% │ Media 0 │ Fonts 0 │ XML 0 │ PDF 0 │ Plugins 0
      Other 6 2.63% │ Unknown 0
  ▶ External (All 26, HTML 16 61.54%, …)
  ▶ Security ▶ Response Codes ▶ URL ▶ Page Titles ▶ Meta Description
  ▶ Meta Keywords ▶ H1 ▶ H2 ▶ Content ▶ Images ▶ Canonicals
  ▶ Pagination ▶ Directives ▶ Hreflang ▶ JavaScript …
```
با کلیک روی هر عنصر، **نمودار دونات** پایین پنل نشان داده می‌شود (Internal → HTML/JavaScript/CSS/Images/Other). وقتی چیزی انتخاب نشده: «Click on an SEO Element to display a graph.»

### پنل راست — Issues
ستون‌ها: `Issue Name │ Issue Type │ Issue Priority │ URLs │ % of Total`
نمونه‌ی واقعی با آیکون‌ها:
- ⚠️ `Links: Pages Without Internal Outlinks` — 22
- ⚠️ `Directives: Noindex` — 22
- ❗ `Hreflang: Missing Return Links` — 5
- ❗ `Response Codes: Internal Client Error (4xx)` — 3
- ℹ️ `Page Titles: Below 30 Characters` — 30
- ℹ️ `Content: Low Content Pages` — 18
- ℹ️ `Page Titles: Below 200 Pixels` — 16
- ℹ️ `Page Titles: Over 60 Characters` — 15
- ℹ️ `Page Titles: Over 561 Pixels` — 10

نام‌گذاری `دسته: مشکل` است. پایین پنل **Issue Details** با دکمه‌ی `Copy` و `View: Details ▾`، شامل دو بخش **Description** و **How To Fix** (متن کامل توضیحی).
با کلیک روی هر مشکل، **جدول اصلی فیلتر می‌شود** و ستون‌هایش عوض می‌شود به: `Address │ Indexability │ Indexability Status │ Crawl Depth │ Link Score`

### پنل راست — Site Structure
`[⊟][⊞] Level: 2 ▾ │ ⬆ Export │ View»`
درخت `Path │ URLs`: `https:/ › onwebs.ir/ › ar/ en/ _next/ uploads/ blog/ portfolio/ brands/ banners/ services/ founders/ ux-design`
`Max Level: 5`
پایینش **نمودار Crawl Depth** (`View: Chart ▾`) — میله‌ای، محور X عمق ۰ تا ۱۰+، رنگ‌بندی: Blocked by robots.txt (خاکستری) / No Response (صورتی) / 2xx (سبز) / 3xx (نارنجی) / 4xx (قرمز) / 5xx (قرمز تیره)

### منوی Reports
`Crawl Overview` `Issues Overview` `Segments Overview` `Redirects ▸` `Canonicals ▸` `Pagination ▸` `Hreflang ▸` `Insecure Content` `SERP Summary` `Orphan Pages` `Structured Data ▸` `Javascript ▸` `PageSpeed ▸` `Mobile ▸` `Accessibility ▸` `HTTP Headers ▸` `Cookies ▸`

### منوی Bulk Export
`Multi-Export` `Queued URLs` `Links ▸` `Web ▸` `Path Type ▸` `Security ▸` `Response Codes ▸` `Content ▸` `Images ▸` `Canonicals ▸` `Directives ▸` `JavaScript ▸` `AMP ▸` `Structured Data ▸` `Sitemaps ▸` `Custom Search ▸` `Custom Extraction ▸` `URL Inspection ▸` `Accessibility ▸` `Issues ▸` `AI ▸`

### منوی Configuration
`Crawl Config ⌘;` `Spider ▸ (Crawl, Extraction, Limits, Rendering, Advanced, Preferences)` `Content ▸` `robots.txt` `URL Rewriting` `CDNs` `Include` `Exclude` `Speed` `User-Agent` `HTTP Header` `Custom ▸ (Custom Search, Custom Extraction, Custom Link Positions, Custom JavaScript)` `API Access ▸` `Authentication ▸` `Segments` `Crawl Analysis` `Profiles ▸`

### پنجره‌ی Crawl Config
دو ستونه: چپ درخت ناوبری با `Search...` بالایش، راست محتوا با breadcrumb `Crawl Config › Spider › Crawl`.
پایین: `✅ Valid config` سمت چپ، `Cancel` و `OK` سمت راست.

**Spider › Crawl** چهار بخش دارد:
- **Resource Links** — Images / Media / CSS / JavaScript / SWF، هرکدام دو چک‌باکس `Crawl` و `Store`
- **Crawl Behaviour** — Check Links Outside of Start Folder / Crawl Outside of Start Folder / Crawl All Subdomains / Follow Internal "nofollow" / Follow External "nofollow" / Crawl Invalid Links
- **Page Links** — Internal Hyperlinks / External Links / Canonicals / Pagination (Rel Next/Prev) / Hreflang / AMP / Meta Refresh / iframes / Mobile Alternate / Uncrawlable Links، هرکدام `Crawl` + `Store`
- **XML Sitemaps** — Crawl Linked XML Sitemaps / Auto Discover XML Sitemaps via robots.txt / Crawl These Sitemaps

