//! Deep-link (de)serialisation for jump-to-locus. A faithful port of
//! `packages/core/src/reader/locus-link.ts`.
//!
//! Stays in TS: nothing; both functions take and return plain data.
//!
//! Known gaps: keys and extra fields the TS copy keeps (unknown keys, key order of
//! the input) are dropped; a JSON number over f64 range or nesting past
//! `serde_json`'s limit parses differently.

use super::anchor::{AnchorPdfLocus, AnchorPositionSelector, AnchorQuoteSelector};
use crate::search::js_text::utf16_len;
use crate::sync::frontmatter::js_number;
use serde_json::Value;

const MAX_LOCUS_PARAM_CHARS: usize = 8_000;
const MAX_QUOTE_FIELD_CHARS: usize = 2_000;
const QUOTE_TYPE: &str = "TextQuoteSelector";
const POSITION_TYPE: &str = "TextPositionSelector";

/// JS `clampQuoteField`: the first `MAX_QUOTE_FIELD_CHARS` UTF-16 units. The cut may
/// leave a lone surrogate, so the result is units, not a `String`.
fn clamp_quote_field(value: &str) -> Vec<u16> {
    value.encode_utf16().take(MAX_QUOTE_FIELD_CHARS).collect()
}

/// One char as JSON text, escaped as `JSON.stringify` does.
fn push_json_char(c: char, out: &mut String) {
    match c {
        '"' => out.push_str("\\\""),
        '\\' => out.push_str("\\\\"),
        '\u{8}' => out.push_str("\\b"),
        '\u{c}' => out.push_str("\\f"),
        '\n' => out.push_str("\\n"),
        '\r' => out.push_str("\\r"),
        '\t' => out.push_str("\\t"),
        c if u32::from(c) < 0x20 => out.push_str(&format!("\\u{:04x}", u32::from(c))),
        c => out.push(c),
    }
}

/// UTF-16 units as a JSON string literal; a lone surrogate becomes `\uXXXX` (as `JSON.stringify`).
fn json_units(units: &[u16]) -> String {
    let mut out = String::from("\"");
    for ch in char::decode_utf16(units.iter().copied()) {
        match ch {
            Ok(c) => push_json_char(c, &mut out),
            Err(e) => out.push_str(&format!("\\u{:04x}", e.unpaired_surrogate())),
        }
    }
    out.push('"');
    out
}

/// A JSON number as `JSON.stringify` writes it; non-finite becomes `null`.
fn json_number(n: f64) -> String {
    if n.is_finite() {
        js_number(n)
    } else {
        "null".to_owned()
    }
}

fn encode_quote(quote: &AnchorQuoteSelector) -> String {
    let mut fields = vec![
        format!(
            "\"type\":{}",
            json_units(&QUOTE_TYPE.encode_utf16().collect::<Vec<u16>>())
        ),
        format!(
            "\"exact\":{}",
            json_units(&clamp_quote_field(quote.exact.as_deref().unwrap_or("")))
        ),
    ];
    if let Some(prefix) = &quote.prefix {
        fields.push(format!(
            "\"prefix\":{}",
            json_units(&clamp_quote_field(prefix))
        ));
    }
    if let Some(suffix) = &quote.suffix {
        fields.push(format!(
            "\"suffix\":{}",
            json_units(&clamp_quote_field(suffix))
        ));
    }
    format!("{{{}}}", fields.join(","))
}

fn encode_position(position: &AnchorPositionSelector) -> String {
    let mut fields = Vec::new();
    if let Some(kind) = &position.kind {
        fields.push(format!(
            "\"type\":{}",
            json_units(&kind.encode_utf16().collect::<Vec<u16>>())
        ));
    }
    if let Some(start) = position.start {
        fields.push(format!("\"start\":{}", json_number(start)));
    }
    if let Some(end) = position.end {
        fields.push(format!("\"end\":{}", json_number(end)));
    }
    format!("{{{}}}", fields.join(","))
}

/// Serialise a locus into a query-param value (raw JSON; encode at the URL layer).
/// Over `MAX_LOCUS_PARAM_CHARS` the position is dropped (TS `encodeLocus`).
#[must_use]
pub fn encode_locus(locus: &AnchorPdfLocus) -> String {
    let quote = encode_quote(&locus.quote);
    let raw = match &locus.position {
        Some(position) => format!(
            "{{\"quote\":{quote},\"position\":{}}}",
            encode_position(position)
        ),
        None => format!("{{\"quote\":{quote}}}"),
    };
    if utf16_len(&raw) > MAX_LOCUS_PARAM_CHARS {
        return format!("{{\"quote\":{quote}}}");
    }
    raw
}

fn hex_value(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// JS `decodeURIComponent`: `None` where it throws (bad `%` escape or invalid UTF-8).
fn percent_decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hi = hex_value(*bytes.get(i + 1)?)?;
            let lo = hex_value(*bytes.get(i + 2)?)?;
            out.push(hi * 16 + lo);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// `JSON.parse(raw)`, else `JSON.parse(decodeURIComponent(raw))` for legacy links.
fn parse_locus_json(raw: &str) -> Option<Value> {
    serde_json::from_str::<Value>(raw).ok().or_else(|| {
        let decoded = percent_decode(raw)?;
        serde_json::from_str::<Value>(&decoded).ok()
    })
}

/// A string field within the quote limit (TS `isOptionalString` plus length checks).
fn quote_text(value: &Value) -> Option<&str> {
    value
        .as_str()
        .filter(|s| utf16_len(s) <= MAX_QUOTE_FIELD_CHARS)
}

fn decode_quote(value: &Value) -> Option<AnchorQuoteSelector> {
    let q = value.as_object()?;
    if q.get("type")?.as_str()? != QUOTE_TYPE {
        return None;
    }
    let exact = quote_text(q.get("exact")?)?;
    if exact.is_empty() {
        return None;
    }
    let prefix = match q.get("prefix") {
        None => None,
        Some(v) => Some(quote_text(v)?.to_owned()),
    };
    let suffix = match q.get("suffix") {
        None => None,
        Some(v) => Some(quote_text(v)?.to_owned()),
    };
    Some(AnchorQuoteSelector {
        kind: Some(QUOTE_TYPE.to_owned()),
        exact: Some(exact.to_owned()),
        prefix,
        suffix,
    })
}

/// TS `isPosition`: finite, non-negative, ordered bounds; anything else is dropped.
fn decode_position(value: &Value) -> Option<AnchorPositionSelector> {
    let p = value.as_object()?;
    if p.get("type")?.as_str()? != POSITION_TYPE {
        return None;
    }
    let start = p.get("start")?.as_f64()?;
    let end = p.get("end")?.as_f64()?;
    if !start.is_finite() || !end.is_finite() || start < 0.0 || end < start {
        return None;
    }
    Some(AnchorPositionSelector {
        kind: Some(POSITION_TYPE.to_owned()),
        start: Some(start),
        end: Some(end),
    })
}

/// Parse a locus param back into an `AnchorPdfLocus`, or `None` when malformed
/// (TS `decodeLocus`). Never panics on any input.
#[must_use]
pub fn decode_locus(raw: Option<&str>) -> Option<AnchorPdfLocus> {
    let raw = raw.filter(|r| !r.is_empty())?;
    if utf16_len(raw) > MAX_LOCUS_PARAM_CHARS {
        return None;
    }
    let parsed = parse_locus_json(raw)?;
    let candidate = parsed.as_object()?;
    let quote = decode_quote(candidate.get("quote")?)?;
    let position = candidate.get("position").and_then(decode_position);
    Some(AnchorPdfLocus { quote, position })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// JS `encodeURIComponent` for the test inputs.
    fn encode_uri_component(s: &str) -> String {
        let mut out = String::new();
        for b in s.bytes() {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
                out.push(char::from(b));
            } else {
                out.push_str(&format!("%{b:02X}"));
            }
        }
        out
    }

    fn quote(exact: &str, prefix: Option<&str>, suffix: Option<&str>) -> AnchorQuoteSelector {
        AnchorQuoteSelector {
            kind: Some("TextQuoteSelector".to_owned()),
            exact: Some(exact.to_owned()),
            prefix: prefix.map(str::to_owned),
            suffix: suffix.map(str::to_owned),
        }
    }

    fn bare_quote(exact: &str) -> AnchorQuoteSelector {
        quote(exact, None, None)
    }

    #[test]
    fn encode_locus_round_trips_through_decode_locus() {
        let locus = AnchorPdfLocus {
            quote: quote("attention is all you need", Some("we show "), Some(".")),
            position: Some(AnchorPositionSelector {
                kind: Some("TextPositionSelector".to_owned()),
                start: Some(100.0),
                end: Some(126.0),
            }),
        };
        let decoded = decode_locus(Some(&encode_locus(&locus)));
        assert_eq!(decoded, Some(locus));
    }

    #[test]
    fn encode_locus_round_trips_quotes_that_contain_percent_signs() {
        let with_pct = AnchorPdfLocus {
            quote: bare_quote("accuracy was 50%"),
            position: None,
        };
        let raw = encode_locus(&with_pct);
        // URLSearchParams hands back the raw JSON unchanged.
        assert_eq!(decode_locus(Some(&raw)), Some(with_pct.clone()));
        assert_eq!(
            decode_locus(Some(&encode_uri_component(&raw))),
            Some(with_pct)
        );
    }

    #[test]
    fn encode_locus_omits_absent_optional_fields() {
        let bare = AnchorPdfLocus {
            quote: bare_quote("x"),
            position: None,
        };
        let decoded = decode_locus(Some(&encode_locus(&bare)));
        assert_eq!(decoded, Some(bare));
    }

    #[test]
    fn decode_locus_rejects_malformed_or_empty_input() {
        assert_eq!(decode_locus(None), None);
        assert_eq!(decode_locus(Some("")), None);
        assert_eq!(decode_locus(Some("%%%not-json")), None);
        assert_eq!(
            decode_locus(Some(&encode_uri_component(r#"{"quote":{}}"#))),
            None
        );
        assert_eq!(
            decode_locus(Some(&encode_uri_component(
                r#"{"quote":{"type":"TextQuoteSelector","exact":""}}"#
            ))),
            None
        );
    }

    #[test]
    fn decode_locus_drops_an_invalid_position_but_keeps_the_quote() {
        let raw = encode_uri_component(
            r#"{"quote":{"type":"TextQuoteSelector","exact":"keep me"},"position":{"type":"Nope","start":"a"}}"#,
        );
        assert_eq!(
            decode_locus(Some(&raw)),
            Some(AnchorPdfLocus {
                quote: bare_quote("keep me"),
                position: None,
            })
        );
    }

    #[test]
    fn decode_locus_rejects_oversized_or_mistyped_quote_and_position_fields() {
        assert_eq!(decode_locus(Some(&"x".repeat(9000))), None);
        assert_eq!(
            decode_locus(Some(
                r#"{"quote":{"type":"TextQuoteSelector","exact":"ok","prefix":12}}"#
            )),
            None
        );
        assert_eq!(
            decode_locus(Some(
                r#"{"quote":{"type":"TextQuoteSelector","exact":"ok"},"position":{"type":"TextPositionSelector","start":5,"end":1}}"#
            )),
            Some(AnchorPdfLocus {
                quote: bare_quote("ok"),
                position: None,
            })
        );
    }
}
