//! Overleaf error text made safe to show: the token and any URL credentials removed, then capped at
//! 500 UTF-16 units. A port of `safeOverleafError` (apps/web/src/features/overleaf/infrastructure/
//! overleaf-error.ts) after its `formatError` step, which stays in TS because it reads the thrown value.

use std::sync::LazyLock;

use regex_lite::Regex;

use crate::papers::js_regex::compile;

/// Longest text returned, in UTF-16 units (matches JS `String.prototype.slice`).
const MAX_UTF16: usize = 500;

/// `/https?:\/\/[^\s]+/gi`: a URL to strip credentials from.
static URL_RE: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"(?i)https?://\S+").ok());

/// Error text with `token` replaced by `[redacted]`, URL credentials removed (an unparseable URL
/// becomes `[redacted-url]`), and the result capped at 500 UTF-16 units. An empty token is ignored.
#[must_use]
pub fn redact_error_text(raw: &str, token: Option<&str>) -> String {
    let replaced = match token.filter(|t| !t.is_empty()) {
        Some(token) => raw.replace(token, "[redacted]"),
        None => raw.to_owned(),
    };
    let scrubbed = match URL_RE.as_ref() {
        Some(re) => re
            .replace_all(&replaced, |caps: &regex_lite::Captures| {
                redact_url(&caps[0])
            })
            .into_owned(),
        None => replaced,
    };
    truncate_utf16(&scrubbed, MAX_UTF16)
}

/// The URL with its username and password cleared, or `[redacted-url]` if it does not parse.
fn redact_url(text: &str) -> String {
    match url::Url::parse(text) {
        Ok(mut parsed) => {
            let _ = parsed.set_username("");
            let _ = parsed.set_password(None);
            parsed.to_string()
        }
        Err(_) => "[redacted-url]".to_owned(),
    }
}

/// The longest prefix of `text` whose UTF-16 length is at most `max`.
fn truncate_utf16(text: &str, max: usize) -> String {
    let mut out = String::new();
    let mut units = 0;
    for ch in text.chars() {
        let width = ch.len_utf16();
        if units + width > max {
            break;
        }
        units += width;
        out.push(ch);
    }
    out
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn replaces_token_everywhere() {
        assert_eq!(
            redact_error_text("bad secret1 and secret1", Some("secret1")),
            "bad [redacted] and [redacted]"
        );
    }

    #[test]
    fn empty_token_is_ignored() {
        assert_eq!(redact_error_text("plain", Some("")), "plain");
        assert_eq!(redact_error_text("plain", None), "plain");
    }

    #[test]
    fn strips_url_credentials() {
        assert_eq!(
            redact_error_text("fail at https://user:pw@git.overleaf.com/x now", None),
            "fail at https://git.overleaf.com/x now"
        );
    }

    #[test]
    fn unparseable_url_is_redacted() {
        assert_eq!(
            redact_error_text("see https://[bad", None),
            "see [redacted-url]"
        );
    }

    #[test]
    fn caps_at_500_utf16_units() {
        let long = "x".repeat(2_000);
        assert_eq!(redact_error_text(&long, None).len(), 500);
        // Two-unit characters count as two each, so 250 of them fill the cap exactly.
        let wide = "\u{1F600}".repeat(300);
        assert_eq!(redact_error_text(&wide, None).encode_utf16().count(), 500);
    }
}
