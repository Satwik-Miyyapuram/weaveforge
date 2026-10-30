//! Byte ranges (RFC 9110 § 14) for files served on the custom scheme.

use std::io::{Read, Seek, SeekFrom};

use crate::protocol::Reply;

/// Largest part one ranged reply carries. A longer request gets this much; the reader asks again.
pub const PART_BYTES_MAX: u64 = 16 * 1024 * 1024;

/// Largest file a reply without a `Range` header reads whole into memory. Larger files (models,
/// big PDFs) must be read in ranges; a whole read of one fails with `ErrorKind::FileTooLarge`.
pub const WHOLE_BYTES_MAX: u64 = 64 * 1024 * 1024;

/// What a `Range` header asks of a body `len_bytes` long.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pick {
    /// Serve the whole body with 200: no header, another unit, several ranges, or a malformed one.
    Whole,
    /// Serve bytes `start_byte..=end_byte` with 206.
    Part {
        /// First byte offset served.
        start_byte: u64,
        /// Last byte offset served, inclusive.
        end_byte: u64,
    },
    /// Nothing in the body matches: 416.
    Unsatisfiable,
}

/// Reads one `Range` header value against a body `len_bytes` long.
#[must_use]
pub fn pick(header: Option<&str>, len_bytes: u64) -> Pick {
    let Some(header) = header else {
        return Pick::Whole;
    };
    let value = header.trim_matches(|c: char| c.is_ascii_whitespace());
    let Some(unit) = value.get(..5) else {
        return Pick::Whole;
    };
    if !unit.eq_ignore_ascii_case("bytes") {
        return Pick::Whole;
    }
    let Some(spec) = value.get(5..).and_then(|rest| rest.strip_prefix('=')) else {
        return Pick::Whole;
    };
    if spec.contains(',') {
        return Pick::Whole;
    }
    let spec = spec.trim_matches(|c: char| c.is_ascii_whitespace());
    let Some((first, last)) = spec.split_once('-') else {
        return Pick::Whole;
    };
    match (first, last) {
        ("", "") => Pick::Whole,
        ("", suffix) => {
            let Some(n) = digits(suffix) else {
                return Pick::Whole;
            };
            if n == 0 || len_bytes == 0 {
                return Pick::Unsatisfiable;
            }
            Pick::Part {
                start_byte: len_bytes - n.min(len_bytes),
                end_byte: len_bytes - 1,
            }
        }
        (from, "") => {
            let Some(a) = digits(from) else {
                return Pick::Whole;
            };
            if a >= len_bytes {
                return Pick::Unsatisfiable;
            }
            Pick::Part {
                start_byte: a,
                end_byte: len_bytes - 1,
            }
        }
        (from, to) => {
            let (Some(a), Some(b)) = (digits(from), digits(to)) else {
                return Pick::Whole;
            };
            if a > b {
                return Pick::Whole;
            }
            if a >= len_bytes {
                return Pick::Unsatisfiable;
            }
            Pick::Part {
                start_byte: a,
                end_byte: b.min(len_bytes - 1),
            }
        }
    }
}

/// Parses a non-empty run of ASCII digits; `None` on anything else or overflow.
fn digits(text: &str) -> Option<u64> {
    if text.is_empty() || !text.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// The reply for `file`: 200 whole, 206 with the picked part (at most `PART_BYTES_MAX`), or 416.
/// `headers` are the headers a whole reply would carry (content type, CSP, …); they are kept on
/// 200 and 206, and on 416 only `accept-ranges` and `content-range` are sent. `content-length`
/// and `content-range` in `headers` are dropped; the reply sets its own range headers.
/// A whole read of a file over `WHOLE_BYTES_MAX` fails with `ErrorKind::FileTooLarge`.
pub fn serve_file(
    file: &std::path::Path,
    header: Option<&str>,
    mut headers: Vec<(&'static str, String)>,
) -> std::io::Result<Reply> {
    headers.retain(|(name, _)| {
        !name.eq_ignore_ascii_case("content-length") && !name.eq_ignore_ascii_case("content-range")
    });
    let mut f = std::fs::File::open(file)?;
    let len_bytes = f.metadata()?.len();
    match pick(header, len_bytes) {
        Pick::Whole => {
            if len_bytes > WHOLE_BYTES_MAX {
                return Err(std::io::Error::from(std::io::ErrorKind::FileTooLarge));
            }
            let mut body = Vec::new();
            let _ = f.read_to_end(&mut body)?;
            headers.push(("accept-ranges", "bytes".to_owned()));
            Ok(Reply {
                status: 200,
                headers,
                body,
            })
        }
        Pick::Part {
            start_byte,
            end_byte,
        } => {
            let end_byte = end_byte.min(start_byte.saturating_add(PART_BYTES_MAX - 1));
            let count = end_byte - start_byte + 1;
            let _ = f.seek(SeekFrom::Start(start_byte))?;
            let mut body = Vec::new();
            let _ = f.take(count).read_to_end(&mut body)?;
            if u64::try_from(body.len()).ok() != Some(count) {
                return Err(std::io::Error::from(std::io::ErrorKind::UnexpectedEof));
            }
            headers.push(("accept-ranges", "bytes".to_owned()));
            headers.push((
                "content-range",
                format!("bytes {start_byte}-{end_byte}/{len_bytes}"),
            ));
            Ok(Reply {
                status: 206,
                headers,
                body,
            })
        }
        Pick::Unsatisfiable => Ok(Reply {
            status: 416,
            headers: vec![
                ("accept-ranges", "bytes".to_owned()),
                ("content-range", format!("bytes */{len_bytes}")),
            ],
            body: Vec::new(),
        }),
    }
}
