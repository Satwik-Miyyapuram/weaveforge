//! Human label for an experiment artifact, ported from
//! `apps/web/src/features/experiments/ui/figure-label.ts`. Pure: no I/O.

use url::Url;

/// Label for the artifact at `url`: its last path segment without the query, percent-decoded.
/// Inline `data:` artifacts have no filename, so they read `figure N` (`index` is 0-based).
/// A storage path (not an absolute URL) is read the same way.
///
/// A name that cannot be decoded (a stray `%` or invalid UTF-8 after decoding) is shown as
/// written. A user-supplied filename like `a%zz.png` is legal, and must not break the panel.
#[must_use]
pub fn figure_label(url: &str, index: u32) -> String {
    if url.starts_with("data:") {
        return format!("figure {}", index + 1);
    }
    let part = match Url::parse(url) {
        Ok(absolute) => absolute
            .path()
            .rsplit('/')
            .next()
            .unwrap_or_default()
            .to_owned(),
        // Not an absolute URL: a storage path, so read it as one.
        Err(_) => url.rsplit('/').next().unwrap_or_default().to_owned(),
    };
    let base = part.split('?').next().unwrap_or_default();
    if base.is_empty() {
        format!("figure {}", index + 1)
    } else {
        decode_or_raw(base)
    }
}

/// `decodeURIComponent`, falling back to the raw text when it would throw.
fn decode_or_raw(text: &str) -> String {
    percent_decode(text).unwrap_or_else(|| text.to_owned())
}

/// Decodes `%XX` escapes as UTF-8. `None` for a malformed escape or bytes that are not UTF-8,
/// which is when `decodeURIComponent` throws. `+` is left alone, as in `decodeURIComponent`.
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hi = hex_value(*bytes.get(i + 1)?)?;
            let lo = hex_value(*bytes.get(i + 2)?)?;
            out.push((hi << 4) | lo);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_urls_are_numbered() {
        assert_eq!(figure_label("data:image/png;base64,AAAA", 0), "figure 1");
        assert_eq!(figure_label("data:image/png;base64,AAAA", 4), "figure 5");
    }

    #[test]
    fn takes_last_segment_of_absolute_url_without_query() {
        assert_eq!(
            figure_label("https://example.org/files/loss-curve.png?v=3", 0),
            "loss-curve.png"
        );
    }

    #[test]
    fn storage_path_is_read_as_a_path() {
        assert_eq!(figure_label("runs/exp-1/plot.svg", 2), "plot.svg");
    }

    #[test]
    fn decodes_escapes() {
        assert_eq!(figure_label("https://example.org/a%20b.png", 0), "a b.png");
        assert_eq!(figure_label("runs/%C3%BCber.png", 0), "über.png");
    }

    #[test]
    fn plus_is_not_a_space() {
        assert_eq!(figure_label("runs/a+b.png", 0), "a+b.png");
    }

    #[test]
    fn malformed_escape_is_shown_raw() {
        assert_eq!(figure_label("runs/a%zz.png", 0), "a%zz.png");
        assert_eq!(figure_label("runs/a%.png", 0), "a%.png");
    }

    #[test]
    fn invalid_utf8_is_shown_raw() {
        assert_eq!(figure_label("runs/%FF.png", 0), "%FF.png");
    }

    #[test]
    fn empty_last_segment_falls_back_to_number() {
        assert_eq!(figure_label("runs/", 1), "figure 2");
        assert_eq!(figure_label("runs/?x=1", 0), "figure 1");
    }
}
