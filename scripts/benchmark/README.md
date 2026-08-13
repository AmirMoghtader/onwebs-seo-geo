# Deterministic crawler transport fixture

This local-only harness provides reproducible HTTP behaviors needed while
tuning the crawler scheduler: fixed latency, concurrency, one redirect hop,
`429 Retry-After`, and `HEAD 405` followed by a successful GET.

It benchmarks the harness/client transport path. It does **not** measure the
whole desktop application and makes no Screaming Frog parity claim.

Run from the repository root:

```sh
python3 scripts/benchmark/crawler_fixture.py \
  --requests 100 --concurrency 16 --latency-ms 25
```

The program writes exactly one compact JSON object to stdout and exits non-zero
if deterministic status/request-count assertions fail. Relevant fields are:

- `latency.throughput_requests_per_second`
- `latency.latency_ms`
- `server.request_count` and `server.peak_active_requests`
- `behavior.redirect`, `behavior.rate_limit`, `behavior.head_405_fallback`
- `assertions` and top-level `ok`

For stable comparisons, use the same machine and exact arguments, run several
times, and retain the complete JSON output with the code revision under test.
