#!/usr/bin/env python3
"""Check a finished fixture crawl against the scenario manifest.

Run `crawl_scenarios.py`, crawl its start URL with the app, then run this
against the crawl database to see whether the acceptance criteria hold.

    python3 scripts/fixtures/verify_crawl.py --port 8899

Exits non-zero if any check fails, so it can gate a validation run.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from collections import Counter

DEFAULT_DB = os.path.expanduser(
    "~/Library/Application Support/rustyseo/db/deep_crawl_batches.db"
)


def load_rows(db_path: str, host: str) -> list[dict]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.execute("SELECT * FROM domain_crawl")
        rows = [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()
    return [r for r in rows if host in (r.get("url") or "")]


def indexability_of(row: dict) -> tuple[float | None, str]:
    """Indexability is stored as a JSON blob in some builds, columns in others."""
    raw = row.get("indexability")
    if isinstance(raw, str) and raw.strip().startswith("{"):
        try:
            parsed = json.loads(raw)
            return parsed.get("indexability"), parsed.get("indexability_reason", "")
        except json.JSONDecodeError:
            pass
    return row.get("indexability"), str(row.get("indexability_reason") or "")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True, help="fixture main port")
    parser.add_argument("--alt-port", type=int, default=0, help="fixture alt port")
    parser.add_argument("--db", default=DEFAULT_DB)
    args = parser.parse_args()

    host = f"127.0.0.1:{args.port}"
    if not os.path.exists(args.db):
        sys.exit(f"crawl database not found: {args.db}")

    rows = load_rows(args.db, host)
    if not rows:
        sys.exit(f"no crawled rows for {host} — was the fixture actually crawled?")

    by_url = {r["url"]: r for r in rows}
    counts = Counter(r["url"] for r in rows)
    results: list[tuple[bool, str]] = []

    def check(ok: bool, label: str) -> None:
        results.append((bool(ok), label))

    base = f"http://{host}"

    # 1. No duplicated rows. The redirect source/target race showed up here.
    dupes = {u: n for u, n in counts.items() if n > 1}
    check(not dupes, f"no duplicate rows (duplicates: {dupes or 'none'})")

    # 2. URL forms that must not be normalised into each other.
    check(
        f"{base}/trailing" in by_url and f"{base}/trailing/" in by_url,
        "/trailing and /trailing/ are separate rows",
    )
    check(
        any("//slash" in u for u in by_url),
        "/double//slash kept its repeated slash",
    )
    query_rows = [u for u in by_url if u.startswith(f"{base}/query")]
    check(len(query_rows) >= 2, f"reordered query strings stay distinct ({len(query_rows)} rows)")

    # 3. Redirect sources are rows in their own right, with their real status.
    for path, want in (("/redirect/simple", 302), ("/redirect/chain1", 301), ("/redirect/chain2", 301)):
        row = by_url.get(base + path)
        check(row is not None and row.get("status_code") == want,
              f"{path} recorded as {want} (got {row.get('status_code') if row else 'missing'})")
    check(base + "/redirect/chain3" in by_url, "/redirect/chain3 recorded as its own 200 row")

    # 4. Robots must have been obeyed on both origins.
    check(not any("/blocked/" in u for u in by_url), "robots-disallowed /blocked/ never crawled")
    if args.alt_port:
        check(
            not any(f"127.0.0.1:{args.alt_port}" in (r.get("url") or "") for r in load_rows(args.db, "127.0.0.1")),
            "cross-host redirect target blocked by the alt origin's robots",
        )

    # 5. Retryable statuses ended up succeeding.
    for path in ("/retry-429", "/retry-503"):
        row = by_url.get(base + path)
        check(row is not None and row.get("status_code") == 200,
              f"{path} recovered to 200 (got {row.get('status_code') if row else 'missing'})")

    # 6. PDF indexability — the fix that stopped treating every binary alike.
    pub = by_url.get(f"{base}/public.pdf")
    priv = by_url.get(f"{base}/private.pdf")
    if pub:
        score, reason = indexability_of(pub)
        check(score == 1.0, f"/public.pdf is indexable (score={score}, {reason!r})")
    else:
        check(False, "/public.pdf missing")
    if priv:
        score, reason = indexability_of(priv)
        check(score == 0.0 and "X-Robots" in reason,
              f"/private.pdf blocked by X-Robots-Tag (score={score}, {reason!r})")
    else:
        check(False, "/private.pdf missing")

    # 7. Nothing was recorded as a synthetic transport failure.
    zero_status = [r["url"] for r in rows if r.get("status_code") == 0]
    check(not zero_status, f"no synthetic status-0 rows ({len(zero_status)} found)")

    passed = sum(1 for ok, _ in results if ok)
    for ok, label in results:
        print(f"{'PASS' if ok else 'FAIL'}  {label}")
    print(f"\n{passed}/{len(results)} checks passed over {len(rows)} rows")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
