# پرامپت جامع توسعه RustySEO تا برابری قابلیت با SEO Spider حرفه‌ای

متن زیر را بدون تغییر یا با کمترین تغییر به ایجنت کدنویس بدهید.

---

## نقش و مأموریت

تو معمار ارشد و توسعه‌دهنده Full-Stack یک اپ دسکتاپ Technical SEO هستی. روی مخزن فعلی `RustySEO-0.4.0` کار کن که با Next.js/React، Tauri/Rust و SQLite ساخته شده است.

هدف: RustySEO را مرحله‌به‌مرحله به یک crawler حرفه‌ای با **برابری قابلیت و workflow** نسبت به Screaming Frog SEO Spider 24.3 برسان، درحالی‌که هویت، UI، کد، متن، asset و trade dress آن محصول را کپی نمی‌کنی. قابلیت‌ها را از استانداردهای عمومی وب و SEO طراحی کن و متن/رابط اصیل RustySEO بساز.

گزارش مبنا را ابتدا کامل بخوان:

- `SCREAMING_FROG_GAP_ANALYSIS_FA.md`
- تمام READMEها و اسناد مخزن
- معماری frontend، فرمان‌های Tauri، مدل‌های Rust، schema/migrationهای SQLite و storeهای Zustand

هیچ قابلیت موجود و مفیدی—به‌خصوص Server Log Analyzer، Image Optimizer، PPC، Clarity، Power BI، Content Planner، Task Manager، GA4/GSC/PSI، فارسی و AI محلی—نباید حذف یا تخریب شود.

## قواعد غیرقابل‌مذاکره

1. با یک بازنویسی Big Bang شروع نکن. کار را در PR/commitهای کوچک، قابل تست و migration-safe تحویل بده.
2. پیش از هر تغییر، مسیر داده واقعی را از UI تا Tauri command، Rust service و SQLite دنبال کن. وجود component یا checkbox به معنی وجود feature نیست.
3. هیچ UI نمایشی، TODO پنهان یا کنترل بدون backend قابل قبول نیست. هر کنترل باید persistence، validation، error state و test داشته باشد.
4. TypeScript و Rust contractها باید تایپ‌شده باشند. `@ts-nocheck` جدید ممنوع است؛ موارد موجود را تدریجی حذف کن.
5. هیچ secret، token، cookie، auth header یا credential در source، Git، log، event payload، export یا crash report قرار نگیرد.
6. credential ثابت Google OAuth فعلی را یک incident امنیتی P0 بدان: مقدار آن را هرگز چاپ نکن؛ حذفش کن، راهنمای rotate/revoke بنویس و storage امن مبتنی بر OS keychain یا credential user-provided ایجاد کن.
7. SQLite migrationها نسخه‌دار، transactional، idempotent و backward-compatible باشند. قبل از migration مخرب، backup و rollback تعریف کن.
8. UI نباید تمام Crawl را در حافظه React/Zustand نگه دارد. paging/virtualization/query server-side و streaming event با backpressure بساز.
9. همه jobهای بلندمدت باید pause/resume/cancel، progress، checkpoint، error recovery و cleanup داشته باشند.
10. Crawl باید politeness، robots، rate limit، host-aware concurrency، retry/backoff و timeout قابل پیکربندی داشته باشد.
11. قابلیت‌های auth/form interaction به‌صورت safe-by-default باشند؛ لینک یا action مخرب را خودکار trigger نکن.
12. CSP و allowlistهای Tauri را حداقلی و feature-scoped نگه دار. برای iframe/remote image wildcard عمومی اضافه نکن.
13. هر rule/issue باید deterministic، قابل تست، قابل توضیح و دارای source URL/inlink باشد.
14. فارسی/انگلیسی را با i18n مرکزی پیاده کن. URL، Regex، XPath، code و header حتی در RTL باید LTR درست داشته باشند.
15. از متن، screenshot، icon، رنگ‌بندی، layout و نام‌گذاری اختصاصی Screaming Frog کپی نکن. متن issueها را اصیل بنویس و به استاندارد عمومی ارجاع بده.
16. اگر یک قابلیت به API پولی یا credential کاربر نیاز دارد، adapter و حالت disabled شفاف بساز؛ secret نمونه یا fake response به‌عنوان feature تمام‌شده ارائه نکن.
17. تا وقتی acceptance criteria یک فاز پاس نشده، به فاز بعدی نرو.

## فاز صفر: Audit، تست مبنا و تثبیت

قبل از افزودن feature جدید:

1. یک Architecture Map بساز: UI route/component → store/hook → Tauri command → Rust module → DB table/event.
2. تمام قابلیت‌های موجود را با وضعیت `working / partial / mock / unreachable / broken` ثبت کن.
3. تست مبنای واحد، integration و حداقل E2E برای start/pause/resume/stop crawl، persistence، export و reload ایجاد کن.
4. fixture site محلی deterministic بساز که شامل این موارد باشد:
   - 2xx/3xx/4xx/5xx، chain و loop؛
   - robots allow/disallow و sitemap index؛
   - canonical درست/غلط/chain/loop؛
   - hreflang return/missing/invalid/x-default؛
   - pagination؛
   - noindex/nofollow/X-Robots-Tag؛
   - raw/rendered اختلاف، Shadow DOM، iframe و console error؛
   - JSON-LD/Microdata/RDFa معتبر/نامعتبر؛
   - duplicate/near-duplicate/thin content؛
   - تصاویر alt/srcset/ابعاد/حجم مختلف؛
   - basic auth، form auth امن و cookie session؛
   - XML/image sitemap، gzip sitemap و sitemap index؛
   - HTML نامعتبر، mixed content و headerهای امنیتی.
5. contract test بین Rust serialized models و TypeScript types بساز.
6. benchmark مبنا برای 10k، 100k و در صورت امکان 1M URL synthetic ثبت کن: زمان، RAM، DB size، queue throughput و UI responsiveness.

### باگ‌های P0 که باید در فاز صفر رفع شوند

- Sitemap را یکپارچه کن. `src-tauri/src/sitemaps.rs` نباید XML Sitemap را مثل صفحه HTML با selector لینک parse کند.
- قرارداد `app/sitemaps/page.tsx` و فرمان Tauri را همسان کن؛ generator واقعی بساز یا UI دروغین را تا آماده‌شدن مخفی کن.
- `SitemapReview` را فقط پس از اتصال کامل به snapshot صحیح و event replay-safe قابل‌دسترسی کن.
- data selector تب Internal را اصلاح و با fixture تست کن تا HTML rows در tab درست خالی نشوند.
- Dashboard issues و affected URLs را از یک `crawl_snapshot_id` واحد بخوان.
- `GeneralSettings` نمایشی را یا به backend واقعی وصل کن یا حذف/ادغام کن؛ تنها یک source of truth برای settings داشته باش.
- CSP مربوط به Power BI/remote content را با allowlist دقیق و opt-in اصلاح کن.
- OAuth credential ثابت را حذف، revoke/rotate و با keychain/secure storage جایگزین کن.
- logging توسعه‌ای و `console.log`های حاوی crawl/auth data را پاک یا redact کن.
- `@ts-nocheck` را در مسیرهای بحرانی با typeهای واقعی جایگزین کن.

### معیار پایان فاز صفر

- هیچ secret ثابت در `rg`/secret scanner پیدا نشود.
- تمام تست‌های baseline سبز باشند.
- UI هیچ control قابل مشاهده‌ای بدون backend/persistence نداشته باشد.
- Sitemap، Internal، Dashboard و Diff از snapshotهای مشخص و همسان استفاده کنند.
- build/lint/typecheck و Tauri tests پاس شوند.

## معماری داده هدف

مدل را طوری طراحی کن که حداقل entityهای زیر را داشته باشد:

- `Project`
- `CrawlProfile` با نسخه، import/export و inheritance محدود
- `CrawlJob` با mode، state، schedule، progress و error
- `CrawlSnapshot` immutable با base snapshot اختیاری
- `UrlRecord` و `FetchAttempt`
- `LinkEdge` با source، destination، anchor، rel، position، discovered_by و rendered/raw
- `ResourceRecord`
- `RedirectHop`
- `DirectiveRecord`
- `CanonicalRecord`
- `HreflangRecord`
- `StructuredDataItem` و validation results
- `CookieRecord` و `HeaderRecord` با redaction
- `RenderedArtifact` برای raw/rendered hash، screenshot/path و console event
- `IssueDefinition`، `IssueOccurrence` و `IssueEvidence`
- `CustomRule`، `CustomExtractionResult` و `CustomJsResult`
- `SegmentDefinition` و materialized membership اختیاری
- `ApiConnection`، `ApiMetric` و quota/cache metadata
- `ComparisonRun` و `FieldChange`
- `ExportPreset`، `ReportJob` و `ScheduleDefinition`
- `EmbeddingRecord` و model/version metadata

الزامات DB:

- foreign key، index و unique constraintهای روشن؛
- normalized URL و original URL هر دو حفظ شوند؛
- dedupe fetch با امکان حفظ duplicate input در List Mode؛
- provenance هر فیلد: raw HTML، rendered DOM، header، API یا محاسبه؛
- snapshotها immutable؛ داده derived قابل rebuild؛
- cursor pagination و query filter server-side؛
- WAL، batch insert، prepared statements و backpressure؛
- schema version و migration test از نسخه فعلی؛
- retention policy و cleanup امن با preview.

## Epic 1: حالت‌های Crawl

### Spider Mode

- crawl subdomain، root domain، start folder یا all subdomains؛
- traversal پیش‌فرض breadth-first و ثبت `discovered_from`/Crawl Path برای توضیح مسیر کشف؛
- check links outside scope بدون الزام fetch؛
- crawl outside start folder؛
- external link checking مستقل؛
- follow/store مستقل برای HTML، image، CSS، JS، media، PDF، canonical، pagination، hreflang، AMP، meta refresh، iframe، mobile alternate و XML sitemap؛
- follow internal/external nofollow قابل تنظیم؛
- کشف uncrawlable و invalid links با reason.

### List Mode

- Paste، drag/drop، TXT/CSV/XLSX و انتخاب column؛
- حفظ ترتیب input و duplicateها در یک `InputRow` جدا از URL dedupe؛
- حالت `preserve exactly` و `URL fix-up` با preview؛
- crawl مستقیم هر URL حتی بدون لینک؛
- bulk status/redirect/render/extraction/API؛
- export با input row id و ترتیب اصلی؛
- قابلیت import URL از sitemap و API result.

### SERP Mode

- ورود یا import URL/title/description؛
- preview responsive با pixel-width و character count؛
- filter missing/duplicate/over/under؛
- export template؛
- این UI باید طراحی اصیل RustySEO داشته باشد.

### Compare Mode

- انتخاب project و دو snapshot؛
- guard برای domain/config ناسازگار با امکان override آگاهانه؛
- compare URL، field، issue، metric، link، segment و site structure؛
- added/removed/missing/changed/unchanged؛
- content change absolute/percentage threshold؛
- mapping URLهای قدیم/جدید برای migration؛
- export تمام تغییرات با old/new values.

### عملیات انتخابی

- `Re-Spider` برای یک یا چند URL با policy روشن درباره overwrite attempt و حفظ history؛
- re-run extraction، issues و post-crawl analysis بدون fetch مجدد، وقتی داده ذخیره‌شده کافی است؛
- نمایش crawl path و دلیل دقیق missing/blocked/not-followed برای debugging.

### API Mode

- URLها را از GA4/GSC/URL Inspection و providerهای لینک دریافت و بدون discovery crawl کن؛
- provenance و quota را نگه دار.

### معیار پذیرش Epic 1

- هر mode مدل job مستقل، persistence و resume دارد.
- fixtureها ترتیب/duplicate List Mode و scope Spider را اثبات می‌کنند.
- Compare دو snapshot با حداقل ۲۰ نوع تغییر را درست گزارش می‌کند.

## Epic 2: Scope، Limits و Network Configuration

پیاده‌سازی کن:

- total URL limit، depth، URLs per depth، folder depth، query-string count، per-subdomain total، max redirects، URL length، links per page، page size و per-path quota؛
- Include/Exclude چندقاعده‌ای با Regex tester، sample result و validation؛
- URL rewrite pipeline با remove parameters، regex replace، lowercase و percent encoding؛
- تعریف CDN/hostهای داخلی؛
- max threads و max URLs/sec per host/global؛
- adaptive throttling براساس latency/429/5xx؛
- timeout connect/read/render، retry policy و exponential backoff با jitter؛
- custom User-Agent و presetهای عمومی؛
- custom HTTP headers با scope و secret redaction؛
- proxy HTTP/SOCKS، auth و bypass؛
- trusted CA/certificate management؛
- cookie modes: none/session/persistent با jar per profile؛
- audit cookie شامل first/third-party، Secure، HttpOnly، SameSite، expiry/max-age، domain/path و source URL؛
- custom robots override/editor/tester و trace دلیل allow/disallow؛
- respect/ignore policy برای noindex، canonical، pagination، HSTS و self meta-refresh؛
- fragments، srcset، HTML assumption، validation و optional carbon calculation.
- profileهای Geo/Language با proxy، `Accept-Language`، header/cookie و امکان compare؛

هر setting باید schema، default، validation، tooltip، persistence، profile override و test داشته باشد.

## Epic 3: Project، Profile، Snapshot و Recovery

- Project Manager برای create/rename/folder/tag/duplicate/archive/delete؛
- Crawl Manager با recent، search، open، resume، compare و retention؛
- Save/Open/Import/Export snapshot با manifest، schema version، checksum و optional compression؛
- auto-save queue، frontier، visited set، config hash و pending API work؛
- crash recovery پس از kill process؛
- profile save/load/default/recent/reset/import/export؛
- انتقال امن crawl/profile/schedule بین اعضای تیم با manifest و بدون secret/token؛
- memory/database mode اگر هر دو واقعاً پشتیبانی می‌شوند؛ در غیر این صورت database-first شفاف؛
- storage estimate، disk warning، cleanup preview و backup؛
- جلوگیری از بازشدن concurrent write روی یک snapshot.

معیار پذیرش: یک Crawl 100k synthetic را در میانه kill کن، app را باز کن و بدون duplicate/lost URL ادامه بده.

## Epic 4: Rendering و JavaScript SEO

- Text-only و Chromium rendering؛
- device preset، viewport، scale، touch، user agent و full-page screenshot؛
- AJAX timeout و network-idle policy؛
- capture raw HTML و rendered DOM با hash و optional compressed storage؛
- diff raw/rendered برای content، links، title، meta description، H1، canonical و robots؛
- capture JS exception، console، blocked resource، failed request و Chrome issue؛
- Shadow DOM و iframe flatten به‌صورت opt-in؛
- website archive opt-in با quota/retention؛
- lower views: Rendered Page، View Source، Resources، Console و Screenshot؛
- browser pool پایدار، concurrency مستقل و cancel بدون zombie process.

معیار پذیرش: fixture JS باید اختلاف‌های مشخص raw/rendered را با evidence و source location درست نشان دهد.

## Epic 5: استخراج و مدل SEO

برای هر URL، با provenance و raw/rendered source استخراج کن:

- URL details: scheme، host، port، path، folder depth، query، fragment، encoding؛
- status، mime، size، timing، redirect type/hops؛
- title/meta description/meta keywords با chars و pixel width؛
- H1/H2 و ترتیب headingها؛
- canonicalها، pagination، mobile alternate، AMP؛
- meta robots و X-Robots-Tag با conflict resolution؛
- hreflang با language/region/x-default؛
- internal/external link edges، anchor، rel، target، position و raw/rendered؛
- images شامل src/srcset/background، alt، dimensions، rendered size و file size؛
- CSS/JS/media/PDF/iframe؛
- PDF شامل link و page number، title، keywords، subject، author، created/modified dates، page count، text، word count، readability، spelling/grammar، download و bulk text export؛
- fragment/named-anchor inventory و تشخیص broken bookmark در source و destination؛
- cookies و response/request headers با redaction؛
- Open Graph/Twitter metadata؛
- JSON-LD/Microdata/RDFa و validation؛
- text، word count، readability، text/HTML ratio، exact/near duplicate fingerprint و n-gram؛
- content area قابل تنظیم با include/exclude selectors.

## Epic 6: Issue Engine جامع

یک rule engine داده‌محور بساز؛ ruleها را در UI componentها hardcode نکن.

هر `IssueDefinition` باید داشته باشد:

- stable id و version؛
- category؛
- severity: error/warning/opportunity/info؛
- priority/confidence؛
- title و توضیح اصیل فارسی/انگلیسی؛
- why-it-matters و remediation؛
- standard/reference URL عمومی؛
- predicate یا evaluator versioned؛
- required fields؛
- affected URL count و sample؛
- evidence، source URL/inlink و export mapping؛
- suppression/ignore per project؛
- status: open/accepted/fixed با note اختیاری.

حداقل خانواده ruleها:

1. Response: robots blocked، no response، 2xx/3xx/4xx/5xx، JS/meta/HSTS redirects، chains و loops.
2. URL: non-ASCII، underscore، uppercase، spaces، multiple slash، repetitive path، internal search، parameters، length، invalid encoding.
3. Title/Description: missing، duplicate، over/under chars/pixels، multiple، outside head، same as H1.
4. H1/H2: missing، duplicate، long، multiple، non-sequential.
5. Content: exact/near duplicate، low content، readability، spelling/grammar.
6. Image: size threshold، missing/empty/long alt، background، srcset، dimension mismatch/CLS risk.
7. Canonical: missing/self/external/non-200/multiple/conflict/chain/loop/outside head.
8. Pagination: missing return، broken sequence، non-200، non-indexable.
9. Directives: noindex/nofollow/noarchive/nosnippet conflicts و header/meta parity.
10. Hreflang: non-200، unlinked، missing return، inconsistent، invalid code، noindex، noncanonical، multiple/conflict، x-default.
11. JavaScript: raw/rendered differences، blocked resources، console errors.
12. Links: depth، orphan/no inlinks، nofollow-only، no outlinks، missing/non-descriptive anchor، excessive in/out، localhost، uncrawlable.
13. Security: HTTP، mixed content، insecure forms، unsafe `_blank`، protocol-relative، HSTS/CSP/X-Content-Type-Options/X-Frame-Options/Referrer-Policy، MIME mismatch.
14. Structured Data/AMP/HTML validation.
15. Sitemap: not in sitemap، orphan in sitemap، noncanonical/nonindexable/redirect/error URLs.
16. PageSpeed/Mobile/Accessibility.
17. Analytics/GSC/API inconsistencies و orphan pages.

یک subsystem مستقل `Crawl Analysis` بساز تا تحلیل‌های derived مانند near-duplicate، Link Score، orphan detection، embeddings و بعضی issueها پس از Crawl به‌صورت دستی یا خودکار اجرا شوند. تغییر threshold/content area باید در صورت کافی‌بودن داده ذخیره‌شده بدون fetch مجدد قابل محاسبه باشد و analysis version/progress/cancel داشته باشد.

به عددسازی صوری برای رسیدن به «۳۰۰» rule نپرداز. ابتدا ruleهای مهم را درست و تست‌شده بساز؛ سپس coverage matrix منتشر کن. هر rule باید fixture مثبت، fixture منفی و regression test داشته باشد.

## Epic 7: Tabها، جدول‌ها و جزئیات

Top-level views مستقل یا قابل پیکربندی برای این حوزه‌ها بساز:

- Internal، External، Security، Response Codes، URL، Titles، Descriptions، Keywords، H1، H2، Content، Images، Canonicals، Pagination، Directives، Hreflang، JavaScript، Links، AMP، Structured Data، Sitemaps، PageSpeed، Mobile، Accessibility، Custom Search، Custom Extraction، Custom JS، Analytics، GSC، Validation، Link Metrics، AI و Change Detection.

Lower details:

- URL Details، Inlinks، Outlinks، Image Details، Duplicate Group، Resources، SERP Preview، Rendered Page، Source، Headers، Cookies، Structured Data، Lighthouse، Accessibility، Spelling/Grammar و N-grams.
- در Duplicate Group، متن‌های مشابه و تفاوت‌ها highlight شوند و similarity هر جفت نمایش داده شود.

Right summaries:

- Overview، Issues، Site Structure، Segments، Response Times، API status، Spelling/Grammar و Semantic Search.

الزام‌ها:

- یک dataset واحد؛ tabها فقط query/filterهای مختلف باشند.
- virtualized rows و server-side sort/filter/search.
- search روی column منتخب یا همه ستون‌های visible، case، regex، AND/OR، negation و query syntax.
- column show/hide/reorder/resize/reset و persist per profile.
- multi-select export، copy، open browser و context actions امن.
- هر count قابل کلیک و قابل ردیابی به URLهای متاثر باشد.

## Epic 8: Custom Search، Extraction و JavaScript

### Custom Search

- text/regex، case، whole word و raw/rendered scope؛
- source، visible text، attribute و response header targets؛
- چند rule، import/export، tester و bulk upload؛
- count و sample/result location.

### Custom Extraction

- XPath، CSS selector و Regex capture group؛
- output: element، inner HTML، text، attribute، function value؛
- visual browser/selector picker، preview روی URL نمونه و validation؛
- حداقل 100 extractor و چند result per page با pagination؛
- raw/rendered scope و typed output؛
- import/export profile.

### Custom JavaScript

- action و extraction snippet؛
- async/Promise، wait condition و timeout؛
- safe interaction primitives برای click/scroll/type فقط با opt-in؛
- result JSON schema و column mapping؛
- snippet library، import/export و share؛
- console/debugger و test روی URL نمونه؛
- sandbox/permission، denylist actionهای خطرناک و secret isolation؛
- cancellation و resource quota.

## Epic 9: Sitemap

- discovery از robots.txt، pathهای استاندارد، HTML links و linked sitemapها؛
- parse استاندارد XML `urlset` و `sitemapindex`، namespace، gzip و nested index؛
- اعتبارسنجی loc/lastmod/hreflang/image/news در حد scope اعلام‌شده؛
- جلوگیری از recursion loop و اعمال size/URL limit؛
- audit تقاطع crawl/sitemap: present، orphan، missing، redirect، 4xx/5xx، noindex، noncanonical، blocked؛
- انتخاب چند sitemap و provenance؛
- XML Sitemap generator با فقط URLهای انتخابی، status/indexability/canonical filters، lastmod، priority و changefreq؛
- split در حد استاندارد 49,999/50,000 امن و sitemap index؛
- Image Sitemap generator؛
- preview، validation، save و deterministic output؛
- test با namespace/gzip/nested/invalid XML.

## Epic 10: Compare، Change Detection و Segments

- snapshot pairing دستی و خودکار؛
- URL mapping و normalization قابل پیکربندی؛
- compare status، title، description، H1، canonical، directives، content hash/percentage، depth، inlinks/outlinks، Link Score، API metrics و issues؛
- added/removed/changed/missing؛
- site structure و directory-level aggregate delta؛
- threshold per field و suppress noisy changes؛
- segment definitions براساس URL regex، path، content type، field filters، custom extraction یا rule composition؛
- summary/issue/API/compare per segment؛
- save/share/import/export segment؛
- scheduled auto-compare و change email/export.

## Epic 11: API Integrations

یک provider interface مشترک با connection test، encrypted credential، cache، quota، retry و provenance بساز.

### GA4

- account/property selection؛
- date range/compare؛
- تا حد API، dimension/metricهای پرکاربرد و قابل انتخاب؛
- URL normalization/mapping؛
- sessions/users/views/conversions/revenue و orphan URLs؛
- per-row API error و refresh.

### Google Search Console

- Search Analytics با property/date/dimension/filter؛
- clicks/impressions/CTR/position؛
- URL Inspection bulk با quota queue، index coverage، robots، crawl time، selected/user canonical و rich result data؛
- orphan و non-indexable-with-traffic reports.

### PageSpeed/CrUX/Lighthouse

- PSI strategy mobile/desktop؛
- CrUX URL و origin metrics؛
- lab metrics، opportunities، diagnostics و CSS/JS coverage؛
- local Lighthouse fallback؛
- cache/versioning و bulk concurrency.

### Link providers

- adapterهای اختیاری Ahrefs، Majestic و Moz؛
- metric mapping typed و Link Metrics tab؛
- کشور/index انتخابی در providerهایی که پشتیبانی می‌کنند؛
- app بدون credential این سرویس‌ها هم کاملاً کار کند.

## Epic 12: Accessibility، Spelling و Semantic Analysis

### Accessibility

- AXE Core versioned در rendered DOM؛
- WCAG rule id/impact/help/node/selector/HTML snippet؛
- filter و export per rule/URL؛
- false-positive suppression per project؛
- remediation اصیل و link به استاندارد.

### Spelling & Grammar

- زبان auto/manual، حداقل فارسی و انگلیسی در اولویت؛
- dictionary، custom words، ignore و rule toggles؛
- location/context، count و export؛
- فقط main content در صورت انتخاب؛
- privacy mode local برای متن حساس.

### Embeddings/Semantic Search

- provider local و cloud با مدل/version؛
- chunking، batching، cache و encrypted API key؛
- vector store یا index مناسب SQLite؛
- similarity search، centroid، outlier، content cluster؛
- keyword-to-page mapping؛
- internal-link opportunity؛
- redirect mapping قدیم به جدید؛
- visualization filterable و export؛
- reindex روشن هنگام تغییر مدل.

## Epic 13: AI

- provider adapter برای Gemini، Ollama، OpenAI و Anthropic؛
- مدل‌ها از API validate شوند و capabilityهای text/image/audio مشخص باشند؛
- prompt library، system prompt، variable template و tester؛
- batch per URL با concurrency/rate/budget/cancel؛
- تا 100 prompt فعال با typed output column؛
- import/export prompt profile؛
- token usage، request count، estimated cost و error per row؛
- cache براساس content hash+model+prompt version؛
- opt-in ارسال content و توضیح privacy؛
- prompt injection defense: داده crawl هیچ‌گاه instruction سیستمی محسوب نشود؛
- secret و header هرگز به model context وارد نشود؛
- image/audio generation فقط opt-in و با storage quota.

AI chat فعلی Gemini/Ollama را حفظ کن، اما آن را از pipeline تحلیلی per-URL تفکیک کن.

## Epic 14: Reports، Exports، Scheduling و CLI

### Export

- CSV، XLSX و در صورت نیاز Google Sheets؛
- current view، selected rows، lower tab، bulk export و multi-export؛
- inlinks/outlinks/anchor، external، nofollow، no-anchor، redirects، canonical، hreflang، security، headers، cookies، structured data، JS console، accessibility، spelling، API، AI و comparison؛
- export preset، skip empty، stable schema، locale-safe delimiter و UTF-8؛
- manifest شامل app version، schema، crawl id، config hash و timestamp؛
- streaming export برای Crawl بزرگ.

### Reports

- crawl overview؛
- issues summary/details؛
- redirect chain/loop؛
- گزارش همه Redirectها با ستون‌های ثابت start/final/indexability/final status و ستون‌های متغیر هر hop و نوع HTTP/JS/Meta Refresh/HSTS؛
- canonical chain/loop؛
- hreflang/pagination؛
- orphan از Sitemap+GA4+GSC؛
- PSI/Lighthouse/coverage؛
- JS console/raw-rendered؛
- security/cookies/mobile/accessibility/validation؛
- comparison/change؛
- PDF فعلی را نگه دار، ولی report data را از query layer مشترک بگیر.

### Scheduler

- one-time، daily/weekly/monthly و interval؛
- project/mode/start URL/list/profile/auth/API؛
- output folder، overwrite/timestamp، Drive/Sheets؛
- selected exports/reports/sitemaps؛
- email/system notification و attachment limit/link fallback؛
- auto-compare با آخرین snapshot موفق؛
- retry، missed-run policy، timezone/DST و lock جلوگیری از overlap؛
- import/export task definition بدون secret.

### CLI/Headless

فرمان‌های پایدار برای:

- spider/list crawl؛
- open/resume/list snapshots؛
- compare؛
- profile/auth reference؛
- save/output/overwrite/timestamp/project؛
- tab/bulk/report export؛
- XML/image sitemap؛
- GA4/GSC/PSI/link providers؛
- JSON progress/log و machine-readable errors؛
- exit code مستند؛
- CLI secret از env/keychain/stdin، نه argument قابل مشاهده در process list.

## Epic 15: Visualization

- force-directed crawl graph 2D و در صورت توجیه performance نسخه 3D؛
- directory tree 2D/3D؛
- crawl tree، directory tree و URL explorer؛
- focus، expand/collapse، search و depth limit؛
- size/color براساس inlinks، word count، Link Score، status، GA4/GSC/API metric، issue و segment؛
- configurable spacing/link length/node cap؛
- deterministic sampling/aggregation برای سایت بزرگ؛
- export PNG/SVG/CSV metadata؛
- anchor/body word cloud؛
- embedding content cluster diagram؛
- visualizationهای فعلی RustySEO را حفظ و به query/segment layer جدید وصل کن.

## Epic 16: MCP Server امن

یک MCP server محلی و opt-in طراحی کن:

- فقط localhost و auth/session token؛
- start/stop/status و autostart opt-in؛
- tools برای create/start/pause/resume/stop/list/open crawl؛
- query URL/field/filter/issue/segment؛
- inlinks/outlinks/content/raw/rendered/screenshot؛
- report/export با preset؛
- comparison و embeddings/semantic query؛
- schema/field/filter discovery؛
- safe file access فقط در base directory allowlisted؛
- read-only پیش‌فرض؛ عملیات نوشتنی با consent؛
- rate limit، size limit، audit log و secret redaction؛
- هیچ arbitrary shell/Node/npm execution پیش‌فرض ارائه نکن؛ اگر نیاز واقعی بود، sandbox و اجازه صریح جداگانه لازم است.

## Epic 17: UI/UX، i18n و onboarding

- طراحی RustySEO را حفظ کن؛ clone تصویری محصول مرجع ممنوع.
- حالت Basic/Advanced یا progressive disclosure برای جلوگیری از شلوغی.
- presetهای هدف‌محور: Technical Audit، JavaScript Audit، Migration، Sitemap Audit، Broken Links، Content Audit، Accessibility و Large Site.
- wizard پیش از Crawl برای scope، load estimate و هشدار auth/rate.
- command palette و search تنظیمات.
- tab/column customization و saved workspace.
- light/dark، keyboard navigation، screen-reader label و focus state.
- i18n کامل `fa` و `en` با plural/date/number و RTL/LTR صحیح.
- errorها actionable باشند و correlation id محلی بدهند؛ secret نشان ندهند.
- auto-update امضاشده با channel و rollback یا آن را صریحاً خارج scope اعلام کن.

## تست و تضمین کیفیت

برای هر Epic:

1. unit test Rust و TypeScript؛
2. DB migration test از نسخه‌های موجود؛
3. Tauri command contract test؛
4. integration test با fixture server؛
5. E2E روی UI اصلی؛
6. regression test برای bugهای P0؛
7. export golden test؛
8. property/fuzz test برای URL normalization، redirect، XML، Regex boundary و malformed HTML؛
9. security test برای SSRF، path traversal، secret leakage، CSP، untrusted HTML و prompt injection؛
10. performance test و memory profile؛
11. cancellation/recovery test؛
12. Windows/macOS/Linux matrix در حد پلتفرم‌های اعلام‌شده پروژه.

قواعد Crawl را فقط با خروجی proprietary یک محصول دیگر کپی نکن. fixture و expected result را از RFCها، WHATWG، Google Search Central، Schema.org، sitemaps.org، W3C/WCAG و AXE بساز. اگر کاربر export قانونی از ابزار مرجع در اختیار گذاشت، فقط به‌عنوان cross-check سازگاری از آن استفاده کن.

## معیارهای عملکرد پیشنهادی

- UI هنگام streaming Crawl بزرگ responsive بماند و عملیات table عمدتاً زیر 100ms perceived باشد.
- حافظه frontend با تعداد کل URL خطی رشد نکند.
- DB insert/query benchmark قبل و بعد هر تغییر ثبت شود.
- queue و renderer backpressure داشته باشند؛ هیچ unbounded channel نباشد.
- export بزرگ streaming باشد و تمام dataset را یک‌جا در RAM نسازد.
- pause/cancel حداکثر در زمان bounded و مستند پاسخ دهد.
- recovery هیچ URL completed را دوباره به‌اشتباه fetch نکند، مگر policy retry آن را مجاز کند.

## تعریف Done برای هر قابلیت

یک قابلیت فقط زمانی Done است که:

- UI قابل دسترسی و بدون mock باشد؛
- backend و persistence واقعی داشته باشد؛
- validation/error/empty/loading/cancel state داشته باشد؛
- permission/privacy آن روشن باشد؛
- test مثبت، منفی و regression پاس شود؛
- export/report مرتبط در صورت نیاز کار کند؛
- فارسی و انگلیسی پوشش داده شوند؛
- مستندات کاربر و توسعه‌دهنده به‌روز شوند؛
- هیچ secret یا داده حساس leak نشود؛
- در coverage matrix وضعیت آن از partial به complete با evidence تغییر کند.

## ترتیب تحویل اجباری

1. فاز صفر: امنیت، contractها، Sitemap/Internal/Dashboard/Settings/CSP.
2. مدل Project/Profile/Snapshot و recovery.
3. List Mode و Crawl configuration کامل.
4. Issue engine و table/query/export foundation.
5. JS parity و custom extraction/JS.
6. Sitemap واقعی و Compare/Change Detection/Segments.
7. GA4/GSC URL Inspection/PSI و reports.
8. Scheduler/CLI و automation.
9. Accessibility/Spelling/Embeddings/Semantic.
10. Link providers، AI pipeline، Visualization و MCP.
11. UX polish، performance hardening و cross-platform release.

در پایان هر مرحله این خروجی‌ها را بده:

- فایل‌های تغییرکرده و دلیل هر تغییر؛
- migration و rollback؛
- تست‌های اجراشده و نتیجه واقعی؛
- benchmark قبل/بعد؛
- موارد هنوز ناقص؛
- اسکرین‌شات یا recording کوتاه برای workflowهای UI؛
- به‌روزرسانی `FEATURE_COVERAGE.md` با evidence path/test.

اگر با ابهام معماری روبه‌رو شدی، ابتدا با شواهد مخزن تصمیم کم‌ریسک بگیر. فقط وقتی انتخاب، scope یا داده کاربر را به‌طور معنادار تغییر می‌دهد سؤال بپرس. هیچ‌گاه با افزودن UI نمایشی یا داده ساختگی، کمبود را پنهان نکن.

---

## منابع مرجع برای ایجنت

- https://www.screamingfrog.co.uk/seo-spider/user-guide/
- https://www.screamingfrog.co.uk/seo-spider/user-guide/general/
- https://www.screamingfrog.co.uk/seo-spider/user-guide/configuration/
- https://www.screamingfrog.co.uk/seo-spider/user-guide/tabs/
- https://www.screamingfrog.co.uk/seo-spider/issues/
- https://www.screamingfrog.co.uk/blog/seo-spider-24/
- https://www.screamingfrog.co.uk/seo-spider/release-history/
- https://www.seerinteractive.com/insights/screaming-frog-guide
