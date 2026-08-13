//! Manual response decompression, so the wire size can be measured.
//!
//! reqwest decompresses gzip and brotli transparently and, when it does, drops
//! `Content-Length` from the headers it hands back. That left no way to answer
//! what Screaming Frog's "Transferred" column asks: how many bytes actually
//! crossed the network. Filling it with the decompressed length made it equal
//! "Size" on 821 of 838 pages of a websima.com crawl, which is precisely the
//! comparison the column exists to make — that homepage is 284,955 bytes of
//! HTML delivered in 34,192 bytes of gzip.
//!
//! So the crawl client asks for the encodings decoded here and nothing else,
//! and decoding happens after the raw bytes have been counted.

use std::io::Read;

/// What the crawl client advertises. Every value here must be handled by
/// [`decode_body`]; asking for an encoding we cannot read would hand us a body
/// we cannot parse.
pub const ACCEPT_ENCODING: &str = "gzip, deflate, br";

/// Refuse to expand beyond this. A compressed body is attacker-controlled and
/// a few kilobytes of zeroes can expand into gigabytes, so the decoder stops
/// rather than letting one page exhaust memory.
const MAX_DECOMPRESSED_BYTES: u64 = 64 * 1024 * 1024;

/// Decompress a response body according to its `Content-Encoding`.
///
/// Unknown or absent encodings pass through untouched — a server that ignored
/// our `Accept-Encoding` and answered in plain text is answering correctly.
pub fn decode_body(raw: &[u8], content_encoding: &str) -> Result<Vec<u8>, String> {
    // 204 and 304 carry the encoding header with no bytes behind it, and a
    // gzip decoder reads that as a truncated stream. Nothing to decode is not
    // a corrupt body.
    if raw.is_empty() {
        return Ok(Vec::new());
    }

    let encoding = content_encoding.trim().to_ascii_lowercase();

    // A proxy chain can stack encodings (`gzip, br`). We advertise single
    // encodings and this is vanishingly rare, but reading only the last one
    // would silently corrupt the body, so it is refused out loud instead.
    if encoding.contains(',') {
        return Err(format!("stacked content-encoding not supported: {}", encoding));
    }

    match encoding.as_str() {
        "" | "identity" => Ok(raw.to_vec()),
        "gzip" | "x-gzip" => inflate(flate2::read::MultiGzDecoder::new(raw)),
        // `deflate` is specified as zlib but is served raw often enough that
        // both have to be tried before calling it a failure.
        "deflate" => inflate(flate2::read::ZlibDecoder::new(raw))
            .or_else(|_| inflate(flate2::read::DeflateDecoder::new(raw))),
        "br" => {
            let mut out = Vec::new();
            brotli::BrotliDecompress(&mut std::io::Cursor::new(raw), &mut out)
                .map_err(|error| format!("brotli decode failed: {}", error))?;
            if out.len() as u64 > MAX_DECOMPRESSED_BYTES {
                return Err("decompressed body exceeds the size limit".to_string());
            }
            Ok(out)
        }
        other => Ok({
            tracing::debug!("Unrequested content-encoding {}, using body as-is", other);
            raw.to_vec()
        }),
    }
}

fn inflate<R: Read>(reader: R) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    reader
        .take(MAX_DECOMPRESSED_BYTES)
        .read_to_end(&mut out)
        .map_err(|error| format!("decode failed: {}", error))?;
    if out.len() as u64 >= MAX_DECOMPRESSED_BYTES {
        return Err("decompressed body exceeds the size limit".to_string());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn gzipped(text: &str) -> Vec<u8> {
        let mut encoder =
            flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(text.as_bytes()).unwrap();
        encoder.finish().unwrap()
    }

    #[test]
    fn gzip_round_trips_and_the_wire_form_is_the_smaller_one() {
        // The point of the column: these two numbers differ.
        let page = "<html><body>".to_string() + &"سلام دنیا ".repeat(500) + "</body></html>";
        let wire = gzipped(&page);

        let decoded = decode_body(&wire, "gzip").unwrap();

        assert_eq!(String::from_utf8(decoded).unwrap(), page);
        assert!(
            wire.len() < page.len(),
            "gzip of a repetitive page should be smaller: {} vs {}",
            wire.len(),
            page.len()
        );
    }

    #[test]
    fn an_uncompressed_body_passes_through_untouched() {
        for encoding in ["", "identity", "IDENTITY"] {
            assert_eq!(decode_body(b"plain", encoding).unwrap(), b"plain");
        }
    }

    #[test]
    fn brotli_round_trips() {
        let mut wire = Vec::new();
        brotli::BrotliCompress(
            &mut std::io::Cursor::new(b"hello brotli".to_vec()),
            &mut wire,
            &Default::default(),
        )
        .unwrap();

        assert_eq!(decode_body(&wire, "br").unwrap(), b"hello brotli");
    }

    #[test]
    fn deflate_accepts_both_the_zlib_and_the_raw_form() {
        let mut zlib =
            flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        zlib.write_all(b"zlib form").unwrap();
        assert_eq!(decode_body(&zlib.finish().unwrap(), "deflate").unwrap(), b"zlib form");

        let mut raw =
            flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        raw.write_all(b"raw form").unwrap();
        assert_eq!(decode_body(&raw.finish().unwrap(), "deflate").unwrap(), b"raw form");
    }

    #[test]
    fn an_empty_body_is_not_treated_as_corruption() {
        // 204 and 304 answer with the header and no bytes; failing those would
        // turn a valid response into a crawl error.
        for encoding in ["", "gzip", "deflate", "br"] {
            assert_eq!(
                decode_body(b"", encoding).unwrap_or_else(|e| panic!("{}: {}", encoding, e)),
                Vec::<u8>::new()
            );
        }
    }

    #[test]
    fn a_corrupt_body_is_an_error_rather_than_garbage() {
        assert!(decode_body(b"this is not gzip at all", "gzip").is_err());
    }

    #[test]
    fn stacked_encodings_are_refused_rather_than_half_decoded() {
        assert!(decode_body(&gzipped("x"), "gzip, br").is_err());
    }

    /// The configuration change this module exists for, exercised end to end
    /// against a server that actually gzips: reqwest must hand back the
    /// compressed bytes so they can be counted, and the decode must recover
    /// the page. If this fails, every page of every crawl parses garbage.
    #[tokio::test]
    async fn the_crawl_client_receives_compressed_bytes_and_recovers_the_page() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let page = "<html><title>سلام</title>".to_string() + &"محتوا ".repeat(400) + "</html>";
        let compressed = gzipped(&page);
        let wire_len = compressed.len();

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let body = compressed.clone();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0_u8; 2_048];
            let _ = socket.read(&mut buffer).await.unwrap();
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Encoding: gzip\r\n\r\n",
            );
            socket.write_all(head.as_bytes()).await.unwrap();
            socket.write_all(&body).await.unwrap();
            socket.shutdown().await.unwrap();
        });

        // Built exactly as the crawler builds it.
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::ACCEPT_ENCODING,
            ACCEPT_ENCODING.parse().unwrap(),
        );
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .no_gzip()
            .no_deflate()
            .no_brotli()
            .build()
            .unwrap();

        let response = client.get(&origin).send().await.unwrap();
        let encoding = response
            .headers()
            .get(reqwest::header::CONTENT_ENCODING)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let raw = response.bytes().await.unwrap();

        // Still compressed on arrival — this is what makes the measurement real.
        assert_eq!(raw.len(), wire_len, "reqwest decompressed behind our back");
        assert!(wire_len < page.len(), "test page must actually compress");

        let decoded = decode_body(&raw, &encoding).unwrap();
        assert_eq!(String::from_utf8(decoded).unwrap(), page);

        server.await.unwrap();
    }

    #[test]
    fn every_advertised_encoding_is_one_we_can_decode() {
        for encoding in ACCEPT_ENCODING.split(',') {
            let name = encoding.trim();
            assert!(
                matches!(name, "gzip" | "deflate" | "br"),
                "advertising {} without a decoder for it",
                name
            );
        }
    }
}
