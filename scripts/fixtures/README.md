# Crawl scenario fixture

A local two-origin site that contains, on purpose, every HTTP behaviour the
crawl lifecycle has to get right. Point the real crawler at it and compare the
result with the manifest the program prints.

```sh
python3 scripts/fixtures/crawl_scenarios.py
```

It prints a JSON manifest (start URL, alt origin, per-route expectations and the
acceptance criteria), then stays up until Ctrl-C, at which point it prints the
exact requests it received — that request log is how you prove a URL was fetched
once, twice, or never.

## How this differs from `scripts/benchmark/`

`scripts/benchmark/crawler_fixture.py` measures the **transport path** with its
own Python client; it never runs the application. This fixture ships **no
client**: the crawler under test is the client, so what you are checking is the
real scheduler, robots handling, redirect following and persistence.

## What it covers

| Area | Routes |
|---|---|
| Redirects | `/redirect/simple` (302), `/redirect/chain1` (301→301→200), `/redirect/loop1` (loop), `/redirect/cross` (to the other origin) |
| Robots per origin | main origin allows all but `/blocked/`; alt origin is `Disallow: /` |
| Retryable statuses | `/retry-429` and `/retry-503`, both with `Retry-After: 1`, succeeding on the retry |
| HEAD fallback | `/head-405` and `/head-403`, both answering GET with 200 |
| PDF indexability | `/public.pdf` (indexable) and `/private.pdf` (`X-Robots-Tag: noindex`) |
| URL forms that must stay distinct | `/trailing` vs `/trailing/`, `/double//slash`, `/query?a=1&a=2&b=3` vs the same pairs reordered |
| Sitemap | `/sitemap.xml`, including `/sitemap-only` which is reachable no other way |

`--slow-sitemap-ms 15000` delays `sitemap.xml` so you can press Stop while the
crawl is still in metadata setup and confirm the control flag is honoured there.

## Acceptance criteria

A correct crawl of this fixture ends with:

- no row missing and no row duplicated — check against the printed request log
- progress that never exceeds 100%
- success reported only when the database rows and the counters agree
- Stop leaving no request or task still running

## Not covered here

Three scenarios in the validation plan cannot be provoked from the server side,
because they are internal to the application: Stop during database
backpressure, a synthetic worker panic, and List mode with valid vs. entirely
invalid input. Those are covered by unit tests today; driving them end to end
needs the crawler to be generic over `tauri::Runtime` so a test can supply a
mock `AppHandle`. See the handoff document for that follow-up.
