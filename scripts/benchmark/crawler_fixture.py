#!/usr/bin/env python3
"""Deterministic localhost HTTP fixture and transport benchmark.

This measures the harness/client behavior only. It is deliberately not a
Screaming Frog comparison and does not claim application-level parity.
Output is one JSON document on stdout, suitable for CI artifact collection.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import http.client
import json
import statistics
import threading
import time
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit


class FixtureState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.counts: Counter[str] = Counter()
        self.active = 0
        self.peak_active = 0

    def enter(self, method: str, path: str) -> None:
        with self.lock:
            self.counts[f"{method} {path}"] += 1
            self.active += 1
            self.peak_active = max(self.peak_active, self.active)

    def leave(self) -> None:
        with self.lock:
            self.active -= 1


class FixtureHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    state: FixtureState
    latency_ms: int

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def do_HEAD(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self._dispatch(head_only=True)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self._dispatch(head_only=False)

    def _dispatch(self, head_only: bool) -> None:
        path = urlsplit(self.path).path
        self.state.enter(self.command, path)
        try:
            if path.startswith("/latency/"):
                time.sleep(self.latency_ms / 1000.0)
                self._reply(200, b"ok", head_only)
            elif path == "/redirect/start":
                self._reply(302, b"", head_only, {"Location": "/redirect/final"})
            elif path == "/redirect/final":
                self._reply(200, b"final", head_only)
            elif path == "/rate-limit":
                self._reply(429, b"limited", head_only, {"Retry-After": "1"})
            elif path == "/head-405" and head_only:
                self._reply(405, b"", True, {"Allow": "GET"})
            elif path == "/head-405":
                self._reply(200, b"get fallback", False)
            else:
                self._reply(404, b"missing", head_only)
        finally:
            self.state.leave()

    def _reply(
        self,
        status: int,
        body: bytes,
        head_only: bool,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if not head_only:
            self.wfile.write(body)


def request(port: int, method: str, path: str) -> tuple[int, dict[str, str]]:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        connection.request(method, path, headers={"User-Agent": "OnwebsSEO-Benchmark/1"})
        response = connection.getresponse()
        response.read()
        return response.status, {name.lower(): value for name, value in response.getheaders()}
    finally:
        connection.close()


def latency_scenario(port: int, requests: int, concurrency: int) -> dict[str, object]:
    started = time.perf_counter()
    first_wave = min(requests, concurrency)
    start_barrier = threading.Barrier(first_wave) if first_wave > 1 else None

    def one(index: int) -> float:
        if start_barrier is not None and index < first_wave:
            start_barrier.wait(timeout=5)
        request_started = time.perf_counter()
        status, _ = request(port, "GET", f"/latency/{index}")
        if status != 200:
            raise RuntimeError(f"unexpected latency status: {status}")
        return (time.perf_counter() - request_started) * 1000.0

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        samples = list(executor.map(one, range(requests)))
    elapsed = time.perf_counter() - started
    sorted_samples = sorted(samples)
    p95_index = max(0, int(len(sorted_samples) * 0.95) - 1)
    return {
        "requests": requests,
        "concurrency": concurrency,
        "elapsed_ms": round(elapsed * 1000.0, 3),
        "throughput_requests_per_second": round(requests / elapsed, 3),
        "latency_ms": {
            "mean": round(statistics.fmean(samples), 3),
            "p95": round(sorted_samples[p95_index], 3),
            "max": round(max(samples), 3),
        },
    }


def behavior_scenario(port: int) -> dict[str, object]:
    first_status, redirect_headers = request(port, "GET", "/redirect/start")
    final_status, _ = request(port, "GET", redirect_headers["location"])
    rate_status, rate_headers = request(port, "GET", "/rate-limit")
    head_status, _ = request(port, "HEAD", "/head-405")
    fallback_status, _ = request(port, "GET", "/head-405")
    return {
        "redirect": {
            "initial_status": first_status,
            "location": redirect_headers.get("location"),
            "final_status": final_status,
            "requests": 2,
        },
        "rate_limit": {
            "status": rate_status,
            "retry_after": rate_headers.get("retry-after"),
            "requests": 1,
        },
        "head_405_fallback": {
            "head_status": head_status,
            "get_status": fallback_status,
            "requests": 2,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--requests", type=int, default=40)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--latency-ms", type=int, default=25)
    args = parser.parse_args()
    if args.requests < 1 or args.requests > 100_000:
        parser.error("--requests must be between 1 and 100000")
    if args.concurrency < 1 or args.concurrency > 1_000:
        parser.error("--concurrency must be between 1 and 1000")
    if args.latency_ms < 0 or args.latency_ms > 60_000:
        parser.error("--latency-ms must be between 0 and 60000")
    return args


def main() -> None:
    args = parse_args()
    state = FixtureState()
    handler = type(
        "ConfiguredFixtureHandler",
        (FixtureHandler,),
        {"state": state, "latency_ms": args.latency_ms},
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    port = server.server_address[1]
    try:
        behavior = behavior_scenario(port)
        latency = latency_scenario(port, args.requests, args.concurrency)
        with state.lock:
            counts = dict(sorted(state.counts.items()))
            peak_active = state.peak_active
        expected_total = args.requests + 5
        actual_total = sum(counts.values())
        assertions = {
            "request_count_exact": actual_total == expected_total,
            "redirect_chain": behavior["redirect"]["initial_status"] == 302
            and behavior["redirect"]["final_status"] == 200,
            "rate_limit_visible": behavior["rate_limit"]["status"] == 429
            and behavior["rate_limit"]["retry_after"] == "1",
            "head_405_requires_get": behavior["head_405_fallback"]["head_status"] == 405
            and behavior["head_405_fallback"]["get_status"] == 200,
            "concurrency_observed": (
                peak_active > 1
                if args.latency_ms > 0 and args.concurrency > 1 and args.requests > 1
                else peak_active >= 1
            ),
        }
        summary = {
            "schema_version": 1,
            "benchmark_scope": "deterministic localhost transport fixture; not product or competitor parity",
            "parameters": {
                "requests": args.requests,
                "concurrency": args.concurrency,
                "latency_ms": args.latency_ms,
            },
            "behavior": behavior,
            "latency": latency,
            "server": {
                "request_count": actual_total,
                "expected_request_count": expected_total,
                "peak_active_requests": peak_active,
                "requests_by_route": counts,
            },
            "assertions": assertions,
            "ok": all(assertions.values()),
        }
        print(json.dumps(summary, sort_keys=True, separators=(",", ":")))
        if not summary["ok"]:
            raise SystemExit(1)
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)


if __name__ == "__main__":
    main()
