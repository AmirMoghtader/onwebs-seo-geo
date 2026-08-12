# تحلیل جامع شکاف RustySEO در مقایسه با Screaming Frog SEO Spider

> تاریخ بررسی: ۲۰ مرداد ۱۴۰۵ / 11 August 2026  
> نسخه مرجع Screaming Frog SEO Spider: `24.3`  
> نوع بررسی RustySEO: مطالعه ایستای کل مخزن، READMEها، رابط، مدل‌ها و فرمان‌های Tauri؛ بدون تغییر کد، اجرای Build یا Crawl زنده

## ۱) نتیجه مدیریتی

RustySEO در وضعیت فعلی یک خزنده فنی ساده نیست؛ هسته Crawl، پایگاه SQLite، رندر JavaScript، داده‌های لینک، متادیتا، تصاویر، Core Web Vitals، GA4، GSC، ابزار لاگ سرور، ابزار تصویر و PPC را دارد. بااین‌حال هنوز هم‌سطح Screaming Frog SEO Spider 24.3 نیست.

بزرگ‌ترین فاصله‌ها در این خانواده‌ها هستند:

1. حالت‌های کاری کامل: List، SERP، Compare، API و Crawl از CLI.
2. ذخیره، بازکردن، ادامه‌دادن و سازمان‌دهی Crawlها به‌صورت پروژه و Snapshot واقعی.
3. Scheduler، اجرای Headless، اعلان ایمیلی، Google Drive/Sheets و Export Preset.
4. کنترل بسیار ریزدامنه Crawl، Scope، Store/Follow، Limits، Include/Exclude و URL Rewriting.
5. مقایسه Crawl و Change Detection در سطح URL، فیلد، Issue، Segment و ساختار سایت.
6. کتابخانه جامع Issues با بیش از ۳۰۰ قاعده، شدت، توضیح، URLهای متاثر و Inlinkهای منبع.
7. Custom Extraction کامل، Custom JavaScript، مرورگر انتخاب‌گر و کتابخانه Snippet.
8. تحلیل JavaScript پیشرفته: مقایسه Raw/Rendered، خطاهای Console، Shadow DOM، iframe و Archive.
9. Accessibility مبتنی بر AXE، غلط‌یابی/دستور زبان، Embeddings و Semantic Search.
10. یکپارچه‌سازی کامل GA4/GSC/URL Inspection/PSI و سرویس‌های Ahrefs، Majestic و Moz.
11. Sitemap واقعی: Parse استاندارد، Audit و ساخت XML/Image Sitemap.
12. گزارش‌ها، Bulk Exportها، Visualizationهای Crawl/Directory و MCP Server.

علاوه بر کمبودها، چند قابلیت نیمه‌کاره یا ناسازگار در مخزن وجود دارد که باید پیش از توسعه قابلیت‌های جدید تثبیت شوند. مهم‌ترین موارد: Sitemap غیرقابل‌دسترسی/ناسازگار، Compare بسیار محدود، صفحه تنظیمات پیشرفته نمایشی، احتمال ناسازگاری داده Dashboard، CSP ناسازگار با Power BI و وجود credential ثابت OAuth در کد منبع.

## ۲) دامنه و روش بررسی

### منابع رسمی پوشش‌داده‌شده

فهرست اصلی User Guide در نسخه فعلی، لینک‌های قابلیت‌محور را عمدتاً به سه صفحه بلند هدایت می‌کند. تمام عنوان‌ها و anchorهای قابلیت‌محور این فهرست بررسی و در گروه‌های زیر ادغام شدند:

- General: نصب، Crawl، ذخیره/بازکردن/Import/Export، Configuration Profile، Scheduling، Robots، User-Agent، حافظه، Cookies، Sitemap، Visualization، Reports، CLI، UI، Search و Update.
- Configuration: تمام گزینه‌های Spider Crawl، Extraction، Limits، Rendering، Advanced، Preferences، Content، Duplicates، Spelling، Embeddings، Robots، Rewrite، CDN، Include/Exclude، Speed، Headers، Custom Search/Extraction/JS، APIها، AI، Authentication، Segments، Storage و MCP.
- Tabs: تمام Top Tabها، Lower Window Tabها و Right Sidebarها.
- Tutorials: لینک‌های کاربردی مرتبط با Crawl، JS، سایت بزرگ، Compare، Data Studio، CWV، Semantic Search، AI، Accessibility، Sitemap، Migration، Hreflang، Pagination، Canonical، URL Inspection، Cookie Audit، Custom JS و موارد مشابه.
- Issues Library و Release Notes نسخه 24 برای کنترل قابلیت‌های جدید.

لینک‌های عمومی فوتر، معرفی شرکت، خدمات آژانس، خرید، ورود، تصاویر و دانلود فایل نصب، چون قابلیتی از SEO Spider را تعریف نمی‌کنند، وارد Feature Matrix نشده‌اند.

### روش تطبیق RustySEO

وضعیت هر قابلیت با این معیارها تعیین شده است:

- **موجود:** مسیر داده، منطق backend و رابط قابل‌استفاده در مخزن دیده شد.
- **ناقص:** بخشی از داده یا رابط وجود دارد، اما پوشش، اتصال، صحت یا Workflow هم‌سطح مرجع نیست.
- **غایب:** پیاده‌سازی قابل‌اتکا در مخزن پیدا نشد.
- **نمایشی:** UI یا متن وجود دارد، اما اتصال عملی به state/backend یا مسیر دسترسی معتبر مشاهده نشد؛ این وضعیت «موجود» حساب نشده است.

این یک Code Audit ایستا است. بدون Build، تست یا Crawl زنده، هیچ ادعای Runtime صددرصدی مطرح نمی‌شود.

## ۳) قابلیت‌هایی که RustySEO واقعاً دارد

- Crawl دامنه با حالت کم‌عمق و عمیق، Pause/Resume/Stop و محدودیت عمق/تعداد URL.
- واکشی HTTP و رندر اختیاری JavaScript با Headless Chrome.
- ثبت URL، status code، content type، response time، page size و crawl depth.
- Title، meta description، headingها، canonical، hreflang، robots/indexability و language.
- لینک‌های داخلی/خارجی، Inlink/Outlink، anchorها، Link Score و Redirect Chainهای پایه.
- تصاویر، alt، ابعاد/حجم، CSS، JavaScript، PDF و سایر فایل‌ها.
- تشخیص duplicate و near-duplicate، word count، Flesch، text/HTML ratio و N-gram/keyword.
- Open Graph، وجود Schema، Cookie و HTTP Headerهای پایه.
- Core Web Vitals/PageSpeed، نمای Mobile و بعضی امتیازهای Lighthouse.
- جست‌وجوی سفارشی مبتنی بر CSS selector و Regex با استخراج text/HTML/attribute.
- Export جدولی CSV/XLSX و گزارش PDF برای Crawl و Log.
- GA4، GSC Search Analytics، PageSpeed API، Gemini/Ollama، Clarity و Power BI در سطحی محدود.
- تاریخچه آماری Crawl در SQLite و Diff ساده URLهای اضافه/حذف‌شده.
- Visualizationهای وضعیت، عمق، زمان پاسخ، وزن، لینک داخلی، treemap، readability و موارد مشابه.
- ابزارهای فراتر از SEO Spider: تحلیل لاگ سرور، بهینه‌سازی تصویر، PPC/Ads، Task Manager و Content Planner.

این مزیت‌های اختصاصی باید در توسعه آینده حفظ شوند و قربانی تقلید رابط Screaming Frog نشوند.

## ۴) ماتریس تفصیلی شکاف‌ها

### A. حالت‌های اجرا، پروژه و چرخه عمر Crawl

| قابلیت مرجع | وضعیت RustySEO | شکاف دقیق | اولویت |
|---|---|---|---|
| Spider Mode | موجود/ناقص | Crawl پایه وجود دارد؛ کنترل subdomain/subfolder/all-subdomains و scope کامل نیست. | P1 |
| List Mode | غایب | ورودی Paste/File، حفظ ترتیب و duplicate، fix-up، crawl دقیق لیست و Export هم‌ردیف وجود ندارد. URL Status Checker جایگزین List Mode نیست. | P1 |
| SERP Mode | غایب | ورود Title/Description و پیش‌نمایش/تحلیل pixel-width در قالب SERP مستقل وجود ندارد. | P2 |
| Compare Mode | ناقص | Diff فعلی فقط URLهای added/removed دو snapshot را نشان می‌دهد؛ element/filter/issue/site-structure/change detection ندارد. | P1 |
| API Mode | غایب | اجرای crawl محدود به URLهای دریافتی از APIهای متصل و workflow مستقل دیده نشد. | P2 |
| Save/Open/Resume Crawl | ناقص | تاریخچه summary ذخیره می‌شود، اما پروژه قابل بازگشایی با تمام URL، edge، queue، config و resume قابل اتکا مشاهده نشد. | P0/P1 |
| Crawl file import/export | غایب | فرمت snapshot قابل حمل با schema version و import/export کامل وجود ندارد. | P1 |
| Project/Crawl Manager | غایب | rename، folders، duplicate، recent، retention و مدیریت چند Crawl در سطح مرجع وجود ندارد. | P1 |
| Configuration Profiles | غایب | save/load/default/recent/reset/import/export پروفایل پیکربندی وجود ندارد. | P1 |
| Auto-save/Crash recovery | ناقص | SQLite وجود دارد، اما durable queue، checkpoint و recovery اثبات‌شده برای ادامه Crawl بزرگ دیده نشد. | P1 |
| Memory vs Database storage | ناقص | DB استفاده می‌شود، اما انتخاب storage mode، allocation، warning و سیاست crawl retention کامل نیست. | P1 |

### B. Automation، CLI و خروجی

| قابلیت مرجع | وضعیت RustySEO | شکاف دقیق | اولویت |
|---|---|---|---|
| Scheduler | غایب | اجرای یک‌باره/دوره‌ای، انتخاب project/config/auth/API/output و مدیریت task وجود ندارد. | P1 |
| Headless CLI | غایب | crawl/list/load/compare/export/report/sitemap/API از command line و exit code استاندارد وجود ندارد. | P1 |
| Scheduled auto-compare | غایب | اتصال Crawl زمان‌بندی‌شده به snapshot قبلی و ایمیل تغییرات وجود ندارد. | P1 |
| Export جاری | ناقص | CSV/XLSX/PDF موجود است، اما export دقیق هر tab/filter/lower tab و multi-select کامل نیست. | P1 |
| Bulk Export | ناقص | صف exportهای inlink/outlink/redirect/canonical/hreflang/security/JS/API و preset جامع وجود ندارد. | P1 |
| Multi Export Presets | غایب | ذخیره انتخاب reportها، skip empty، naming و reuse وجود ندارد. | P2 |
| Google Sheets/Drive | ناقص/غایب | کدهایی برای Sheets دیده می‌شود، اما workflow کامل احراز هویت، پوشه، overwrite/timestamp، scheduled output و Data Studio timeseries وجود ندارد. | P2 |
| Email notification/attachments | غایب | ایمیل پایان/خطا/تغییر و پیوست export/report وجود ندارد. | P2 |
| Scheduled task import/export | غایب | جابه‌جایی definition تسک‌ها بین سیستم‌ها وجود ندارد. | P3 |

### C. کنترل Crawl و شبکه

| قابلیت مرجع | وضعیت RustySEO | شکاف دقیق | اولویت |
|---|---|---|---|
| Crawl/Store مستقل برحسب نوع منبع | ناقص | جمع‌آوری HTML/CSS/JS/Image/File هست، ولی toggle مستقل برای follow و store هر نوع کامل نیست. | P1 |
| Canonical/Pagination/Hreflang/AMP/Meta Refresh/Mobile Alternate | ناقص | بخشی استخراج می‌شود؛ کنترل follow/store و audit کامل برای همه موجود نیست. | P1 |
| Uncrawlable/Invalid links | ناقص | parser و report اختصاصی برای invalid/unencoded/non-HTTP و دلیل uncrawlable کامل نیست. | P1 |
| Outside start folder/all subdomains | ناقص | رفتار و UI قابل تست هم‌سطح مرجع دیده نشد. | P1 |
| nofollow follow policy | ناقص | داده nofollow تا حدی هست؛ سیاست follow داخلی/خارجی و گزارش nofollow-only کامل نیست. | P1 |
| Include/Exclude Regex + Tester | غایب/ناقص | فیلتر جامع pre-crawl با tester و چند rule مشاهده نشد. | P1 |
| URL rewriting | غایب | حذف parameter، regex replace، lowercase و percent-encoding پیش از queue وجود ندارد. | P2 |
| CDN as internal | غایب | تعریف host/CDNهای سفارشی برای طبقه‌بندی internal وجود ندارد. | P2 |
| Limits کامل | ناقص | max depth/URL هست؛ per-depth، folder depth، query count، per-subdomain، path quota، max links/page، max page size و URL length کامل نیست. | P1 |
| Speed control | موجود/ناقص | concurrency/delay/retry هست؛ max URLs/sec، auto-throttle، host-aware politeness و پروفایل سرور کامل نیست. | P1 |
| Response timeout/5xx retry | موجود/ناقص | timeout/retry عمومی هست؛ رفتار دقیق و گزارش retry نیازمند تثبیت است. | P1 |
| User-Agent | موجود | لیست UA و تنظیمات پایه وجود دارد. | — |
| Custom HTTP headers | غایب | چند header/profile، redaction و scope امن وجود ندارد. | P1 |
| Proxy | غایب | HTTP/SOCKS، auth، bypass و تست اتصال وجود ندارد. | P2 |
| Trusted certificates | غایب | مدیریت CA/certificate و خطاهای TLS وجود ندارد. | P2 |
| Authentication | غایب/ناقص | Basic/Digest/NTLM/form-based/bearer و workflow امن session قابل مشاهده نیست. | P1 |
| Cookie policy | ناقص | استخراج Cookie وجود دارد؛ session/persistent/none، jar و audit کامل وجود ندارد. | P1 |
| Robots testing/custom robots | ناقص | نمایش robots وجود دارد؛ override/editor/tester و reason trace کامل نیست. | P1 |
| Re-Spider selected URLs | غایب | بازواکشی انتخابی URLهای خطادار و به‌روزرسانی کنترل‌شده همان Snapshot مشاهده نشد. | P1 |
| Geo/language crawl profiles | غایب/ناقص | ساخت profile برای IP/proxy، `Accept-Language` و header/cookieهای جغرافیایی همراه با مقایسه نتایج وجود ندارد. | P2 |
| Cookie audit details | ناقص | first/third-party، Secure، HttpOnly، SameSite، expiry، domain/path و source URL باید تحلیل و report شوند. | P1/P2 |

### D. Rendering و استخراج

| قابلیت مرجع | وضعیت RustySEO | شکاف دقیق | اولویت |
|---|---|---|---|
| Text vs JavaScript rendering | ناقص | Headless render وجود دارد؛ پروفایل device/viewport/scale/touch و کنترل کامل Chromium نیست. | P1 |
| Raw vs Rendered parity | غایب | diff محتوا، link، title، description، H1، canonical و noindex بین HTML خام و DOM رندرشده وجود ندارد. | P1 |
| Screenshot per URL | غایب | تصویر cover گزارش، جای screenshot آرشیوی/تمام‌صفحه برای هر URL را نمی‌گیرد. | P2 |
| JavaScript errors/Console/Chrome Issues | غایب | capture، tab، filter و export خطاهای browser console دیده نشد. | P1 |
| Flatten Shadow DOM/iframe | غایب | استخراج محتوای shadow root و iframe در DOM نهایی وجود ندارد. | P2 |
| Website archive | غایب | ذخیره HTML خام/رندرشده، screenshot و resourceهای هر URL وجود ندارد. | P2 |
| View Source/Rendered Page/Resources | ناقص | داده‌هایی موجود است، اما lower tabs و parity کامل source/render/resources وجود ندارد. | P1 |
| Custom Search | ناقص | CSS/Regex و extraction پایه هست؛ raw/rendered scope، bulk rule، flags و تعداد نتیجه کامل نیست. | P1 |
| Custom Extraction | ناقص | CSS text/html/attribute هست؛ XPath، regex capture، visual selector، preview، function values، 100 extractor و چند نتیجه وجود ندارد. | P1 |
| Custom JavaScript | غایب | action/extraction snippet، Promise، interaction، library، import/export، debugger و result schema وجود ندارد. | P1 |
| Custom link positions | غایب | طبقه‌بندی nav/header/footer/sidebar/content با selector سفارشی وجود ندارد. | P2 |
| Content area include/exclude | غایب | استخراج main content با selectorهای include/exclude قابل پیکربندی نیست. | P1 |
| PDF audit/extraction | ناقص | PDF به‌عنوان فایل شناسایی می‌شود؛ link discovery با page number، title/keywords/subject/author/dates/page count، text/readability/spelling، save و bulk text export کامل نیست. | P2 |

### E. داده‌ها، Tabها و Issue Engine

| قابلیت مرجع | وضعیت RustySEO | شکاف دقیق | اولویت |
|---|---|---|---|
| Internal/External/Response/URL tabs | ناقص | داده پایه هست؛ filter taxonomy، ستون‌ها و exportهای کامل نیست. Internal view نیز نیازمند تست اتصال data selector است. | P0/P1 |
| Title/Meta/H1/H2 | موجود/ناقص | فیلدها موجودند؛ pixel width، outside-head، sequence و مجموعه filterهای کامل کم است. | P1 |
| Content/Duplicate | ناقص | exact/near duplicate، readability و n-gram هست؛ similarity threshold/profile و duplicate detail گروهی کامل نیست. | P1 |
| Spelling & Grammar | غایب | زبان‌ها، واژه‌نامه، rule، ignore، محل خطا و export وجود ندارد. | P2 |
| Images | ناقص | alt/size/dimensions موجود؛ background image، srcset، incorrect dimensions/CLS و جزئیات کامل کم است. | P1 |
| Canonical | ناقص | استخراج هست؛ chain/loop/multiple/conflict/non-200/outside-head و report کامل نیست. | P1 |
| Pagination | ناقص | rel next/prev ممکن است استخراج شود؛ sequence/return/non-indexable audit کامل نیست. | P2 |
| Directives | ناقص | robots/indexability هست؛ همه meta/X-Robots/header directiveها و conflict reason کامل نیست. | P1 |
| Hreflang | ناقص | استخراج پایه هست؛ return links، x-default، invalid code، canonical/noindex و conflictهای کامل کم است. | P1 |
| Links | ناقص | in/out/anchor/link score هست؛ crawl path، no-anchor، descriptive anchor، localhost، no-outlinks، nofollow-only، link-position و broken fragment/bookmark کامل نیست. | P1 |
| Security | ناقص | HTTPS و چند header هست؛ mixed content، unsafe target blank، insecure forms، protocol-relative و header-policy issueها کامل نیست. | P1 |
| AMP | غایب/ناقص | validator و issue/export اختصاصی مشاهده نشد. | P3 |
| Structured Data | ناقص | وجود Schema ثبت می‌شود؛ JSON-LD/Microdata/RDFa details، Schema.org validation و Google rich-result validation کامل نیست. | P1 |
| HTML Validation | غایب | invalid elements in head، HTML validator و location/export وجود ندارد. | P2 |
| Accessibility | غایب | امتیاز Lighthouse جای rule engine مبتنی بر AXE/WCAG، node location و remediation را نمی‌گیرد. | P1/P2 |
| Mobile | ناقص | بعضی امتیازها هست؛ viewport، tap target، font، content width، plugin و alternate audit کامل نیست. | P2 |
| PageSpeed | ناقص | API و bulk score هست؛ CrUX URL/origin، Lighthouse details، opportunity/diagnostic و CSS/JS coverage کامل نیست. | P1 |
| Issue library | بسیار ناقص | Dashboard حدود محدودی issue می‌سازد؛ مرجع بیش از ۳۰۰ Issue/Warning/Opportunity با severity و context دارد. | P1 |
| Affected URLs/Inlinks | ناقص | بعضی viewها هست؛ هر issue باید URL، reason، source inlinks و export deterministic داشته باشد. | P1 |

### F. Sitemap، Search Console و APIها

| قابلیت مرجع | وضعیت RustySEO | شکاف دقیق | اولویت |
|---|---|---|---|
| XML Sitemap discovery/parse | ناقص/ناسازگار | crawler جدید event سایت‌مپ می‌فرستد، اما panel آن mount نشده؛ فرمان مستقل sitemap به‌جای XML، لینک HTML می‌خواند. | P0 |
| Sitemap audit | نمایشی/ناقص | component مقایسه declared/crawled نوشته شده، اما تب آن comment شده و workflow قابل‌دسترسی نیست. | P0 |
| XML Sitemap generator | غایب | comment وجود دارد، ولی تولید XML، split/index، lastmod/changefreq/priority و filter وضعیت پیاده نشده است. | P1 |
| Image Sitemap | غایب | generator و export استاندارد image sitemap وجود ندارد. | P2 |
| GA4 | ناقص | اتصال/جدول هست؛ انتخاب dimension/metric گسترده، چند account/property، orphan analysis و mapping کامل نیست. | P1 |
| GSC Search Analytics | ناقص | داده‌هایی وجود دارد؛ tab/filter/orphan و mapping کامل نیازمند تکمیل است. | P1 |
| GSC URL Inspection | غایب | bulk inspection، index status، canonical selected، last crawl و quota handling مشاهده نشد. | P1 |
| PSI/CrUX/Lighthouse | ناقص | PSI موجود؛ coverage و جزئیات مرجع کامل نیست. | P1 |
| Ahrefs/Majestic/Moz | غایب | integration per-URL، country index و link metric tab وجود ندارد. | P2 |
| API result caching/quota/error | ناقص | orchestration مشترک، cache، retry، quota و provenance یکپارچه دیده نشد. | P1 |

### G. AI، Semantic Search و Segmentation

| قابلیت مرجع | وضعیت RustySEO | شکاف دقیق | اولویت |
|---|---|---|---|
| Gemini/Ollama chat | موجود/ناقص | chat/context وجود دارد؛ per-URL result column و batch prompt orchestration مرجع نیست. | P2 |
| OpenAI/Anthropic providers | غایب | provider adapter و تنظیم امن key/model وجود ندارد. | P2 |
| Prompt library/tester | غایب | تا 100 prompt، system prompt، import/export، preview و typed outputs وجود ندارد. | P2 |
| Token usage/model validation | غایب | محاسبه مصرف، هزینه تقریبی، validation زنده مدل و budget/cancel وجود ندارد. | P2 |
| AI media generation | غایب | image/audio result pipeline و export وجود ندارد. | P3 |
| Embeddings | غایب | مدل local/cloud، vector persistence، batching و similarity index وجود ندارد. | P2 |
| Semantic Search | غایب | centroid، outlier، keyword-to-page mapping، internal-link opportunity و competitor mapping وجود ندارد. | P2 |
| Content cluster diagram | غایب | cluster محتوایی تعاملی و filterable وجود ندارد. | P2 |
| Segments | غایب | segment مبتنی بر URL/filter/custom rule با summary، API و compare وجود ندارد. taxonomy لاگ جایگزین segment crawler نیست. | P1 |

### H. Compare، Reporting و Visualization

| قابلیت مرجع | وضعیت RustySEO | شکاف دقیق | اولویت |
|---|---|---|---|
| Crawl comparison | بسیار ناقص | فقط URL added/removed؛ mapping snapshot، changed fields، filters، issues، metrics، site structure و exports غایب‌اند. | P1 |
| Change Detection | غایب | تغییر status/title/meta/H1/content/depth/inlinks/indexability با threshold و added/removed/missing وجود ندارد. | P1 |
| Post-crawl analysis | ناقص/غایب | تحلیل‌های derived مانند near-duplicate، Link Score و orphan باید دستی/خودکار و بدون Crawl مجدد قابل اجرا و بازاجرا باشند. | P1 |
| Crawl overview report | ناقص | PDF موجود است؛ consistency و coverage کامل tab/API/issue نیازمند بازطراحی است. | P1 |
| Redirect/canonical/hreflang reports | ناقص | بخشی از redirect هست؛ reportهای زنجیره/loop/return/conflict کامل نیست. | P1 |
| Orphan report | غایب/ناقص | ادغام Sitemap+GA+GSC برای URLهای orphan کامل نیست. | P1 |
| Security/cookie/mobile/accessibility/validation reports | ناقص/غایب | گزارش‌های مستقل و export location/source کامل نیست. | P2 |
| Crawl/tree visualizations | ناقص | چند نمودار هست؛ force-directed crawl/directory tree 2D/3D، crawl tree و URL explorer کامل نیست. | P2 |
| Visualization interaction | ناقص | focus/expand/collapse/search، scale-by metric، segment colors و تنظیم spacing/link length کامل نیست. | P2 |
| Word cloud | ناقص/غایب | n-gram هست؛ anchor/body word cloud تعاملی مستقل مشاهده نشد. | P3 |

### I. UI، جست‌وجو، MCP و عملیات

| قابلیت مرجع | وضعیت RustySEO | شکاف دقیق | اولویت |
|---|---|---|---|
| Advanced table search | ناقص | search پایه هست؛ all-visible-columns، regex، case، AND/OR، negative و query syntax کامل نیست. | P1 |
| Tab/column customization | ناقص | layoutهای مختلف هست؛ drag/hide/reset/persist/focus/detach در سطح مرجع کامل نیست. | P2 |
| Localization | ناقص | فارسی و انگلیسی مخلوط‌اند؛ i18n مرکزی، RTL/LTR per-field و پوشش تمام رشته‌ها لازم است. | P1 |
| Auto update | نامشخص/غایب | update channel، signature، rollback و UI وضعیت مشاهده نشد. | P2 |
| Notifications | غایب | system notification برای completion/error/scheduled tasks وجود ندارد. | P2 |
| MCP Server | غایب | سرور local محدودشده برای کنترل crawl، query URL، reports، exports و embeddings وجود ندارد. | P2 |
| Safe file/API tool surface | غایب | allowlisted base directory، read-only-by-default و consent برای toolهای AI وجود ندارد. | P1/P2 |
| Usage statistics | غایب | opt-in telemetry شفاف و privacy controls مشاهده نشد. | P3 |
| Green hosting/carbon | غایب | تشخیص green host و carbon estimate وجود ندارد. | P3 |

## ۵) ایرادهای فعلی که نباید با «کمبود Feature» مخلوط شوند

این موارد ابتدا باید به‌عنوان Stabilization انجام شوند:

1. **Sitemap دو پیاده‌سازی ناسازگار دارد:** backend مستقل `crawl_sitemaps` لینک‌های `<a>` یک صفحه HTML را جمع می‌کند، نه XML Sitemap؛ در مقابل crawler دامنه event سایت‌مپ تولید می‌کند، اما `SitemapReview` در `BottomContainer` mount نشده است.
2. **صفحه مستقل Sitemap قرارداد داده ناهماهنگ دارد:** UI شیء شامل `links` و `sitemap_xml` انتظار دارد، اما فرمان Rust آرایه URL برمی‌گرداند و generator وجود ندارد.
3. **Compare واقعی نیست:** `DiffChecker` تنها اضافه/حذف URL را نمایش می‌دهد و حتی snapshotها/هویت پروژه به مدل Compare کامل وصل نیستند.
4. **تنظیمات پیشرفته نمایشی‌اند:** `GeneralSettings` کنترل‌های زیادی شبیه crawler حرفه‌ای نشان می‌دهد، اما به state/backend واقعی متصل نیست و مسیر tab آن هم ظاهراً قابل‌دسترسی نیست. منبع حقیقت تنظیمات، `SettingsModal/useSettings` است.
5. **ریسک Internal table:** selector داده Crawl براساس active tab باید بازبینی شود؛ احتمال خالی‌شدن ردیف‌های HTML در تب Internal وجود دارد.
6. **ناسازگاری Dashboard:** شمارش issueها از crawl history و URLهای متاثر از live store می‌آیند؛ ممکن است دو snapshot متفاوت را با هم نشان دهند.
7. **CSP:** `frame-src 'none'` با iframe مربوط به Power BI ناسازگار است و allowlist تصاویر remote هم باید کنترل شود.
8. **ریسک امنیتی بحرانی:** credential ثابت Google OAuth در کد منبع پیدا شد. باید فوراً revoke/rotate شود، از تاریخ Git نیز پاک‌سازی امن شود و credential فقط از ورودی کاربر/OS keychain یا flow عمومی امن خوانده شود. مقدار secret نباید در log، UI، export یا گزارش ظاهر شود.
9. **`@ts-nocheck` و logging توسعه‌ای:** در componentهای مهم وجود دارد و احتمال پنهان‌کردن خطاهای قرارداد داده را بالا می‌برد.
10. **تاریخچه summary است، نه Snapshot قابل بازگشایی:** حذف/نمایش آمار هست، ولی شواهد کافی برای بازکردن تمام داده Crawl قبلی و ادامه queue وجود ندارد.

## ۶) آنچه کاربران حرفه‌ای واقعاً مهم می‌دانند

مرور راهنماهای استفاده و گفتگوهای کاربران نشان می‌دهد صرفاً زیادکردن تعداد tabها کافی نیست. بیشترین ارزش عملی در این workflowهاست:

- Custom Extraction و Custom JavaScript برای auditهای اختصاصی.
- List Mode برای migration، redirect QA، PPC URL و backlink verification.
- Compare/Change Detection برای release، migration و monitoring.
- Database mode و recovery برای سایت‌های بسیار بزرگ.
- Exportهای ثابت و قابل تکرار برای تیم و مشتری.
- Internal-link audit با Inlink، anchor، link position، crawl depth و Link Score.
- JavaScript parity برای تشخیص تفاوت source و rendered DOM.
- Segments و filterهای قابل ذخیره برای تمرکز بر template یا بخش تجاری خاص.
- Sitemap+GA+GSC برای پیدا کردن orphan و وضعیت indexation.
- N-gram، embeddings و semantic similarity برای content audit و redirect mapping.
- Re-Spider انتخابی و Crawl Path برای رفع سریع دلیل URLهای گمشده یا خطاهای موقت.
- انتقال crawl/config/schedule بدون انتقال secret برای همکاری تیمی.

نقدهای تکرارشونده درباره Screaming Frog نیز مهم‌اند: رابط متراکم، منحنی یادگیری بالا و ماهیت desktop-first. RustySEO باید قدرت فنی را با onboarding، progressive disclosure، presetهای هدف‌محور و رابط فارسی/انگلیسی روشن ارائه کند؛ نه اینکه تراکم و ظاهر اختصاصی مرجع را کپی کند.

## ۷) ترتیب پیشنهادی توسعه

### P0 — امنیت و صحت پایه

- حذف و rotate کردن OAuth secret ثابت.
- یکپارچه‌کردن مدل Sitemap و فعال‌کردن فقط workflow واقعی.
- رفع Internal table، Dashboard snapshot mismatch و CSP.
- تعریف source of truth برای settings، حذف/تبدیل mockها و افزودن contract test.
- تعریف Snapshot durable و migration-safe برای Crawl.

### P1 — هسته برابری حرفه‌ای

- List Mode، Compare/Change Detection و Project/Crawl Manager.
- Crawl profiles، scope/store/follow/limits/include/exclude/auth/headers.
- Raw/Rendered parity، Console errors و custom extraction/JS.
- Issue engine جامع، tab/filter/lower-details و exportهای deterministic.
- Sitemap parse/audit/generator؛ GA4/GSC/URL Inspection/PSI کامل.
- Scheduler و Headless CLI.

### P2 — قابلیت‌های پیشرفته

- Accessibility/AXE، spelling/grammar، segments، embeddings و semantic search.
- Ahrefs/Majestic/Moz، AI multi-provider و prompt library.
- Visualizationهای 2D/3D، reports، Google Drive/Sheets و email.
- MCP با سطح دسترسی امن.

### P3 — تکمیل و تمایز

- SERP mode، AMPهای legacy، word clouds، carbon، telemetry opt-in و media generation.
- بهبود onboarding و presetهای ساده برای استفاده‌های پرتکرار.

## ۸) محدودیت حقوقی و طراحی

هدف باید **برابری قابلیت و Workflow** باشد، نه clone کردن محصول:

- از کد، asset، icon، screenshot، متن Issue، نام‌گذاری اختصاصی، layout و trade dress متعلق به Screaming Frog کپی نشود.
- قواعد SEO بر پایه استانداردهای عمومی و مستندات اصلی Google/W3C/Schema.org/AXE بازنویسی شوند.
- توضیح هر Issue با متن اصیل، منبع استاندارد و test fixture مستقل نوشته شود.
- نام و هویت RustySEO و مزیت‌های فعلی آن حفظ شود.

## ۹) چک‌لیست پوشش Tutorialهای رسمی

صفحه مستقل هر مورد زیر باز و Workflow آن با پروژه تطبیق داده شد. موارد هم‌پوشان در ماتریس بالا ادغام شده‌اند:

- شروع و عملیات: Getting Started، Broken Links، Large Websites، Staging، Cloud/Xvfb، Team Work، Password Protected Sites.
- معماری و Crawl: Site Architecture Visualisations، Missing Pages Debugging، HTTP Status Troubleshooting، Robots Tester، Link Score، Internal Linking، Link Position، Broken Bookmarks.
- تغییر و مهاجرت: Compare Crawls، Redirect Audit، Bulk Redirect Checker، Site Migration، Vector Redirect Mapping و Change/Parity Audit.
- JavaScript: JavaScript Crawling، Raw/Rendered Parity، Custom JS Debugging و Simulated User Interactions.
- محتوا: Duplicate/Near-Duplicate، N-Grams، Readability، Spelling/Grammar، Semantic Similarity/Outliers و PDF Audit.
- عناصر فنی: Canonical، Hreflang، Pagination، AMP، Invalid Head Elements، HSTS/307، Structured Data و Image Alt.
- Sitemap و Indexation: XML Sitemap Audit، XML/Image Sitemap Generator، Orphan Pages و GSC URL Inspection Automation.
- Performance/Quality: Core Web Vitals، Accessibility و Cookie Audit.
- Extraction/Automation: Web Scraping، Custom Search، AI Prompts، ChatGPT، Data Studio Automation و Email/Export Attachments.
- کاربردهای جانبی: Geo-IP Redirect Bypass و Broken Link Building.

## ۱۰) منابع

### منابع رسمی Screaming Frog

- [User Guide Index](https://www.screamingfrog.co.uk/seo-spider/user-guide/)
- [General Guide](https://www.screamingfrog.co.uk/seo-spider/user-guide/general/)
- [Configuration Guide](https://www.screamingfrog.co.uk/seo-spider/user-guide/configuration/)
- [Tabs Guide](https://www.screamingfrog.co.uk/seo-spider/user-guide/tabs/)
- [Issues Library](https://www.screamingfrog.co.uk/seo-spider/issues/)
- [SEO Spider 24 Release Notes](https://www.screamingfrog.co.uk/blog/seo-spider-24/)
- [Release History](https://www.screamingfrog.co.uk/seo-spider/release-history/)
- [Compare Crawls Tutorial](https://www.screamingfrog.co.uk/seo-spider/tutorials/how-to-compare-crawls/)
- [JavaScript Crawling Tutorial](https://www.screamingfrog.co.uk/seo-spider/tutorials/crawl-javascript-seo/)
- [Web Scraping & Custom Extraction](https://www.screamingfrog.co.uk/seo-spider/tutorials/web-scraping/)

### منابع مستقل و تجربه کاربران

- [Seer Interactive — Screaming Frog Guide to Doing Almost Anything: 60+ Uses](https://www.seerinteractive.com/insights/screaming-frog-guide)
- [TechRadar — Screaming Frog SEO Spider Review](https://www.techradar.com/reviews/seo-spider)
- [G2 — User Reviews, Pros and Cons](https://www.g2.com/products/screaming-frog-services/reviews?qs=pros-and-cons)
- [Reddit r/SEO — Most Useful Features Used Heavily](https://www.reddit.com/r/SEO/comments/1iwwch6/what_are_the_most_useful_features_you_use_heavily/)
- [Reddit r/TechSEO — Advanced Uses](https://www.reddit.com/r/TechSEO/comments/pephbe/what_are_some_advanced_uses_of_screaming_frog_you/)
- [Reddit r/SEO — Large Crawl/Database Mode Discussion](https://www.reddit.com/r/SEO/comments/1itxa4e/)
- [Reddit r/bigseo — Crawling Very Large Sites](https://www.reddit.com/r/bigseo/comments/ijc9wg/)

## ۱۱) شواهد اصلی در مخزن RustySEO

- `app/global/page.tsx`
- `app/global/_components/TablesContainer/TablesContainer.tsx`
- `app/global/_components/Sidebar/BottomContainer.tsx`
- `app/global/_components/Sidebar/BottomContainer/HistoryDomainCrawls.tsx`
- `app/global/_components/Sidebar/BottomContainer/SitemapReview.tsx`
- `app/global/_components/SEODashboard/DashboardSEO.tsx`
- `app/components/ui/SettingsModal/useSettings.ts`
- `app/components/ui/GeneralSettings/GeneralSettings.tsx`
- `app/components/ui/DiffChecker/DiffChecker.tsx`
- `app/components/ui/Extractors/CustomSearchRuleEditor.tsx`
- `app/components/ui/AiContainer/AIcontainer.tsx`
- `app/sitemaps/page.tsx`
- `src-tauri/src/domain_crawler/models.rs`
- `src-tauri/src/domain_crawler/domain_crawler.rs`
- `src-tauri/src/domain_crawler/extractors/html.rs`
- `src-tauri/src/domain_crawler/helpers/headless_fetch.rs`
- `src-tauri/src/domain_crawler/database.rs`
- `src-tauri/src/sitemaps.rs`
- `src-tauri/src/gsc.rs`
- `src-tauri/src/gsc_auth.rs`
