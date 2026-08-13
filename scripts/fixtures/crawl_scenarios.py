#!/usr/bin/env python3
"""End-to-end crawl scenario fixture.

Serves a small site that deliberately contains every HTTP behaviour the crawl
lifecycle has to get right: redirect shapes, per-origin robots, retryable
statuses, HEAD fallbacks, PDFs with and without X-Robots-Tag, and URL forms
that must NOT be collapsed into one another.

Unlike `scripts/benchmark/crawler_fixture.py`, which exercises the transport
path with its own client, this one serves no client at all. Point the real
crawler at the printed start URL and check its output against the manifest
this program writes to stdout.

    python3 scripts/fixtures/crawl_scenarios.py

Two origins are started, because robots policy is per-origin and a redirect
that crosses hosts must pick up the target origin's rules, not the source's.

Options:
    --port / --alt-port     fix the ports instead of taking free ones
    --slow-sitemap-ms       delay sitemap.xml, to test Stop during metadata setup
    --duration              seconds to stay up (default: until interrupted)
"""

from __future__ import annotations

import argparse
import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Retryable routes answer with their status this many times before succeeding,
# so a crawler that honours Retry-After eventually gets a 200 and one that does
# not is visibly stuck on the error.
RETRY_BUDGET = 1

PDF_BYTES = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"


class Scenario:
    """Mutable counters shared by every request handler thread."""

    def __init__(self, slow_sitemap_ms: int) -> None:
        self.lock = threading.Lock()
        self.hits: dict[str, int] = {}
        self.slow_sitemap_ms = slow_sitemap_ms

    def hit(self, key: str) -> int:
        with self.lock:
            self.hits[key] = self.hits.get(key, 0) + 1
            return self.hits[key]

    def snapshot(self) -> dict[str, int]:
        with self.lock:
            return dict(self.hits)


def html(title: str, links: list[str] = (), extra: str = "") -> bytes:
    anchors = "\n".join(f'<a href="{href}">{href}</a>' for href in links)
    return (
        "<!doctype html><html><head>"
        f"<title>{title}</title>"
        '<meta name="description" content="scenario fixture page">'
        "</head><body>"
        f"<h1>{title}</h1>{anchors}{extra}"
        "</body></html>"
    ).encode()


# Every page the spider should reach from "/". Anything not linked here can only
# be found through the sitemap, which is intentional.
INDEX_LINKS = [
    "/page-a",
    "/page-b",
    "/redirect/simple",
    "/redirect/chain1",
    "/redirect/loop1",
    "/redirect/cross",
    "/retry-429",
    "/retry-503",
    "/truncated-body",
    "/head-405",
    "/head-403",
    "/public.pdf",
    "/private.pdf",
    "/trailing",
    "/trailing/",
    "/double//slash",
    "/query?a=1&a=2&b=3",
    "/query?b=3&a=1&a=2",
    "/blocked/secret",
]


class MainHandler(BaseHTTPRequestHandler):
    """Primary origin."""

    protocol_version = "HTTP/1.1"
    scenario: Scenario = None  # type: ignore[assignment]
    alt_port: int = 0

    def log_message(self, *_args) -> None:  # keep stdout clean for the manifest
        pass

    def _send(
        self,
        status: int,
        body: bytes = b"",
        content_type: str = "text/html; charset=utf-8",
        headers: dict[str, str] | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _redirect(self, status: int, location: str) -> None:
        self._send(status, b"", headers={"Location": location})

    def do_HEAD(self) -> None:  # noqa: N802
        self._route(head=True)

    def do_GET(self) -> None:  # noqa: N802
        self._route(head=False)

    def _route(self, head: bool) -> None:
        path = self.path
        route = path.split("?", 1)[0]
        self.scenario.hit(f"{self.command} {path}")

        if route == "/robots.txt":
            # The primary origin allows everything except /blocked/.
            self._send(
                200,
                b"User-agent: *\nDisallow: /blocked/\nSitemap: /sitemap.xml\n",
                "text/plain; charset=utf-8",
            )
            return

        if route == "/truncated-body":
            # The failure that made every one of 27 URLs in an 810-page
            # websima.com crawl unrecoverable: the request succeeds, headers
            # promise a length, and the connection dies mid-body. A crawler
            # that retries the *read* gets the page on the next attempt; one
            # that only retries the request records a permanent failure.
            body = html("Truncated then whole", ["/"])
            if self.scenario.hit("truncate/served") <= RETRY_BUDGET:
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body[: len(body) // 3])
                self.wfile.flush()
                self.close_connection = True
                return
            self._send(200, body)
            return

        if route == "/sitemap.xml":
            if self.scenario.slow_sitemap_ms:
                # A deliberately slow sitemap: press Stop while this is hanging
                # to prove the metadata phase honours the control flag.
                time.sleep(self.scenario.slow_sitemap_ms / 1000)
            urls = ["/", "/page-a", "/sitemap-only", "/public.pdf"]
            entries = "".join(f"<url><loc>http://{self.headers['Host']}{u}</loc></url>" for u in urls)
            self._send(
                200,
                f'<?xml version="1.0" encoding="UTF-8"?><urlset '
                f'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>'.encode(),
                "application/xml",
            )
            return

        if route == "/":
            self._send(200, html("index", INDEX_LINKS))
            return

        if route in ("/page-a", "/page-b", "/sitemap-only"):
            self._send(200, html(route.strip("/")))
            return

        # --- redirects -----------------------------------------------------
        if route == "/redirect/simple":
            self._redirect(302, "/page-a")
            return
        if route == "/redirect/chain1":
            self._redirect(301, "/redirect/chain2")
            return
        if route == "/redirect/chain2":
            self._redirect(301, "/redirect/chain3")
            return
        if route == "/redirect/chain3":
            self._send(200, html("chain destination"))
            return
        if route == "/redirect/loop1":
            self._redirect(302, "/redirect/loop2")
            return
        if route == "/redirect/loop2":
            self._redirect(302, "/redirect/loop1")
            return
        if route == "/redirect/cross":
            # Crossing origins: the target's robots must decide, not ours.
            self._redirect(302, f"http://127.0.0.1:{self.alt_port}/target")
            return

        # --- retryable statuses --------------------------------------------
        if route == "/retry-429":
            if self.scenario.hit("budget:429") <= RETRY_BUDGET:
                self._send(429, b"slow down", headers={"Retry-After": "1"})
            else:
                self._send(200, html("recovered after 429"))
            return
        if route == "/retry-503":
            if self.scenario.hit("budget:503") <= RETRY_BUDGET:
                self._send(503, b"unavailable", headers={"Retry-After": "1"})
            else:
                self._send(200, html("recovered after 503"))
            return

        # --- HEAD fallbacks -------------------------------------------------
        if route == "/head-405":
            self._send(405, b"") if head else self._send(200, html("head 405 then get"))
            return
        if route == "/head-403":
            self._send(403, b"") if head else self._send(200, html("head 403 then get"))
            return

        # --- PDFs -----------------------------------------------------------
        if route == "/public.pdf":
            self._send(200, PDF_BYTES, "application/pdf")
            return
        if route == "/private.pdf":
            self._send(200, PDF_BYTES, "application/pdf", {"X-Robots-Tag": "noindex"})
            return

        # --- URL forms that must stay distinct -------------------------------
        # /trailing and /trailing/ are different resources on this server, which
        # is exactly why the crawler must not normalise one into the other.
        if route == "/trailing":
            self._send(200, html("no trailing slash"))
            return
        if route == "/trailing/":
            self._send(200, html("with trailing slash"))
            return
        if route == "/double//slash":
            self._send(200, html("repeated slash preserved"))
            return
        if route == "/query":
            self._send(200, html(f"query {path}"))
            return

        if route.startswith("/blocked/"):
            # Reachable only if robots was ignored; the crawl must never get here.
            self._send(200, html("ROBOTS VIOLATION"))
            return

        self._send(404, html("not found"))


class AltHandler(MainHandler):
    """Secondary origin: disallows everything, to test cross-host robots."""

    def _route(self, head: bool) -> None:
        route = self.path.split("?", 1)[0]
        self.scenario.hit(f"ALT {self.command} {self.path}")
        if route == "/robots.txt":
            self._send(200, b"User-agent: *\nDisallow: /\n", "text/plain; charset=utf-8")
            return
        if route == "/target":
            self._send(200, html("ALT ORIGIN REACHED"))
            return
        self._send(404, html("alt not found"))


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def serve(handler_cls, port: int, scenario: Scenario, alt_port: int) -> ThreadingHTTPServer:
    handler_cls.scenario = scenario
    handler_cls.alt_port = alt_port
    server = ThreadingHTTPServer(("127.0.0.1", port), handler_cls)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def manifest(port: int, alt_port: int) -> dict:
    """What a correct crawl of this fixture must produce."""
    return {
        "start_url": f"http://127.0.0.1:{port}/",
        "alt_origin": f"http://127.0.0.1:{alt_port}/",
        "expectations": {
            "distinct_rows": [
                "/trailing and /trailing/ must be two rows, not one",
                "/double//slash keeps its repeated slash",
                "/query?a=1&a=2&b=3 and /query?b=3&a=1&a=2 stay distinct",
            ],
            "redirects": {
                "/redirect/simple": "302 row of its own, plus the /page-a row",
                "/redirect/chain1": "301 rows for chain1 and chain2, 200 for chain3",
                "/redirect/loop1": "loop detected, recorded with its real 302 status",
                "/redirect/cross": "302 recorded; target blocked by the alt origin's robots",
            },
            "retryable": {
                "/retry-429": "honours Retry-After, ends 200",
                "/retry-503": "honours Retry-After, ends 200",
            },
            "head_fallback": {
                "/head-405": "HEAD 405 then GET 200",
                "/head-403": "HEAD 403 then GET 200",
            },
            "indexability": {
                "/public.pdf": "indexable",
                "/private.pdf": "not indexable (X-Robots-Tag: noindex)",
            },
            "robots": {
                "/blocked/secret": "never fetched",
                "alt origin /target": "never fetched (Disallow: /)",
            },
            "acceptance": [
                "no row missing and no row duplicated",
                "progress never exceeds 100%",
                "success reported only when the database and the counters agree",
                "Stop leaves no request or task still running",
            ],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--alt-port", type=int, default=0)
    parser.add_argument("--slow-sitemap-ms", type=int, default=0)
    parser.add_argument("--duration", type=float, default=0.0)
    args = parser.parse_args()

    port = args.port or free_port()
    alt_port = args.alt_port or free_port()
    scenario = Scenario(args.slow_sitemap_ms)

    main_server = serve(MainHandler, port, scenario, alt_port)
    alt_server = serve(AltHandler, alt_port, scenario, alt_port)

    print(json.dumps(manifest(port, alt_port), indent=2, ensure_ascii=False), flush=True)
    print(f"\nCrawl this: http://127.0.0.1:{port}/   (Ctrl-C to stop)\n", flush=True)

    try:
        if args.duration:
            time.sleep(args.duration)
        else:
            while True:
                time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        main_server.shutdown()
        alt_server.shutdown()
        print(json.dumps({"requests": scenario.snapshot()}, indent=2), flush=True)


if __name__ == "__main__":
    main()
