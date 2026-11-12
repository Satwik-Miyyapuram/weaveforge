//! Which proxy responses count as a PDF. Port of `isPdfContentType` and `hasPdfMagic` in
//! `apps/web/src/features/reader/application/pdf-response-rules.ts`. The hosted and desktop PDF
//! proxies share these rules, so both call the wasm build of this module.

/// How far into the body `%PDF` may sit; some servers send a preamble.
pub const PDF_MAGIC_WINDOW: usize = 1024;

/// The lowercased media type before any `;` parameters, as JS
/// `value.split(";")[0].trim().toLowerCase()` gives it.
#[must_use]
pub fn media_type_essence(value: &str) -> String {
    value.split(';').next().unwrap_or("").trim().to_lowercase()
}

/// A PDF, or an unlabelled binary that the magic check then decides. Missing or empty values are
/// not PDFs.
#[must_use]
pub fn is_pdf_content_type(value: Option<&str>) -> bool {
    match value {
        None => false,
        Some("") => false,
        Some(raw) => {
            let essence = media_type_essence(raw);
            essence == "application/pdf" || essence == "application/octet-stream"
        }
    }
}

/// True when `%PDF` appears within the first [`PDF_MAGIC_WINDOW`] bytes.
#[must_use]
pub fn has_pdf_magic(bytes: &[u8]) -> bool {
    let window = &bytes[..bytes.len().min(PDF_MAGIC_WINDOW)];
    window.windows(4).any(|chunk| chunk == b"%PDF")
}

/// Longest address `host_of` shows whole, in UTF-16 units. A longer one is cut.
const HOST_SHOW_UNITS: usize = 60;
/// Units kept from a cut address, before the `…`.
const HOST_CUT_UNITS: usize = 57;

/// The text a failed read shows when a browser reports only a fetch failure.
const CROSS_ORIGIN_REASON: &str = "the host does not allow this app to read its PDF (cross-origin)";

/// The host and port of a PDF address for a failure line (TS `hostOf`). An address with no host
/// shows whole; one that does not parse is cut to 57 units and `…` when longer than 60.
#[must_use]
pub fn host_of(url: &str) -> String {
    let Ok(parsed) = url::Url::parse(url) else {
        return cut_long_address(url);
    };
    match parsed.host_str().filter(|host| !host.is_empty()) {
        Some(host) => match parsed.port() {
            Some(port) => format!("{host}:{port}"),
            None => host.to_owned(),
        },
        None => url.to_owned(),
    }
}

/// Keeps `value` whole when it is at most [`HOST_SHOW_UNITS`] UTF-16 units, else its first
/// [`HOST_CUT_UNITS`] units and `…`.
fn cut_long_address(value: &str) -> String {
    if value.encode_utf16().count() <= HOST_SHOW_UNITS {
        return value.to_owned();
    }
    let mut kept = String::new();
    let mut used = 0;
    for ch in value.chars() {
        let width = ch.len_utf16();
        if used + width > HOST_CUT_UNITS {
            break;
        }
        used += width;
        kept.push(ch);
    }
    format!("{kept}…")
}

/// Why a paper could not be read (TS `readFailureReason`). An HTTP status names itself. A browser
/// fetch failure names the cross-origin refusal, because the two look the same. Anything else is
/// the message as given.
#[must_use]
pub fn read_failure_reason(message: &str, status: Option<u16>) -> String {
    if let Some(status) = status {
        return format!("the host answered {status}");
    }
    let lowered = message.to_ascii_lowercase();
    let fetch_failed = ["failed to fetch", "networkerror", "load failed"]
        .iter()
        .any(|needle| lowered.contains(needle));
    if fetch_failed {
        return CROSS_ORIGIN_REASON.to_owned();
    }
    message.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_of_keeps_host_and_port_only() {
        assert_eq!(
            host_of("https://arxiv.org/pdf/1234.5678.pdf?token=x"),
            "arxiv.org"
        );
        assert_eq!(host_of("http://localhost:8080/a.pdf"), "localhost:8080");
    }

    #[test]
    fn host_of_shows_short_unparseable_text_whole_and_cuts_long_text() {
        assert_eq!(host_of("not a url"), "not a url");
        let long = "x".repeat(70);
        assert_eq!(host_of(&long), format!("{}…", "x".repeat(57)));
    }

    #[test]
    fn read_failure_reason_names_status_then_cross_origin_then_message() {
        assert_eq!(
            read_failure_reason("boom", Some(404)),
            "the host answered 404"
        );
        assert_eq!(
            read_failure_reason("TypeError: Failed to fetch", None),
            CROSS_ORIGIN_REASON
        );
        assert_eq!(
            read_failure_reason("the PDF had no pages", None),
            "the PDF had no pages"
        );
    }

    #[test]
    fn read_failure_reason_names_every_browser_fetch_failure_as_cross_origin() {
        assert_eq!(
            read_failure_reason("NetworkError when attempting to fetch resource.", None),
            CROSS_ORIGIN_REASON
        );
        assert_eq!(
            read_failure_reason("Load failed", None),
            CROSS_ORIGIN_REASON
        );
    }
}
