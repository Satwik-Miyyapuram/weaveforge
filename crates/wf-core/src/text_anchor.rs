//! Pinning a comment to a passage of changing text.
//!
//! An anchor is the passage plus up to [`CONTEXT`] UTF-16 units either side. Finding it again
//! takes the occurrence of the quote whose surroundings agree best. Offsets are UTF-16, as in JS.

use crate::search::js_text::is_js_whitespace;
use crate::sharing::CommentAnchor;

/// Context kept either side of a quote, in UTF-16 units.
pub const CONTEXT: usize = 32;

/// A `[start, end)` range in UTF-16 units.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TextSpan {
    /// Start offset.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub start: usize,
    /// End offset.
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub end: usize,
}

/// Where a span starts and ends, as `[text node index, offset within it]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SpanPoints {
    /// Start point.
    #[cfg_attr(feature = "specta", specta(type = (u32, u32)))]
    pub start: [usize; 2],
    /// End point.
    #[cfg_attr(feature = "specta", specta(type = (u32, u32)))]
    pub end: [usize; 2],
}

fn string(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

/// A JS offset (`ToIntegerOrInfinity`) clamped to `[0, len]`.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss
)]
fn offset(value: f64, len: usize) -> usize {
    if value.is_nan() || value <= 0.0 {
        0
    } else {
        if value.trunc() >= len as f64 {
            len
        } else {
            value.trunc() as usize
        }
    }
}

/// The anchor for `text.slice(start, end)`, or `None` for an empty or blank span.
#[must_use]
pub fn anchor_at(text: &str, start: f64, end: f64) -> Option<CommentAnchor> {
    let units: Vec<u16> = text.encode_utf16().collect();
    let len = units.len();
    let from = offset(start.min(end), len);
    let to = offset(start.max(end), len).max(from);
    let quote = string(&units[from..to]);
    if quote.trim_matches(is_js_whitespace).is_empty() {
        return None;
    }
    Some(CommentAnchor {
        quote,
        prefix: string(&units[from.saturating_sub(CONTEXT)..from]),
        suffix: string(&units[to..(to + CONTEXT).min(len)]),
    })
}

/// Locate `span` across text nodes of the given lengths, or `None` when the text is shorter
/// than the span. A boundary that falls between two nodes lands at the end of the earlier one.
#[must_use]
pub fn span_points(lengths: &[usize], span: TextSpan) -> Option<SpanPoints> {
    let mut seen = 0;
    let mut start: Option<[usize; 2]> = None;
    for (i, &len) in lengths.iter().enumerate() {
        if start.is_none() && span.start <= seen + len {
            start = Some([i, span.start - seen]);
        }
        if let Some(from) = start
            && span.end <= seen + len
        {
            return Some(SpanPoints {
                start: from,
                end: [i, span.end - seen],
            });
        }
        seen += len;
    }
    None
}

fn index_of(hay: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if from > hay.len() || needle.len() > hay.len() - from {
        return None;
    }
    (from..=hay.len() - needle.len()).find(|&at| &hay[at..at + needle.len()] == needle)
}

fn shared_suffix(a: &[u16], b: &[u16]) -> usize {
    a.iter()
        .rev()
        .zip(b.iter().rev())
        .take_while(|(x, y)| x == y)
        .count()
}

fn shared_prefix(a: &[u16], b: &[u16]) -> usize {
    a.iter().zip(b).take_while(|(x, y)| x == y).count()
}

/// Where `anchor` is in `text` now, or `None` when its quote no longer occurs.
#[must_use]
pub fn locate_anchor(text: &str, anchor: &CommentAnchor) -> Option<TextSpan> {
    if anchor.quote.is_empty() {
        return None;
    }
    let hay: Vec<u16> = text.encode_utf16().collect();
    let quote: Vec<u16> = anchor.quote.encode_utf16().collect();
    let prefix: Vec<u16> = anchor.prefix.encode_utf16().collect();
    let suffix: Vec<u16> = anchor.suffix.encode_utf16().collect();
    let mut best = None;
    let mut best_score = None;
    let mut next = index_of(&hay, &quote, 0);
    while let Some(at) = next {
        let end = at + quote.len();
        let before = &hay[at.saturating_sub(prefix.len())..at];
        let after = &hay[end..(end + suffix.len()).min(hay.len())];
        let score = shared_suffix(before, &prefix) + shared_prefix(after, &suffix);
        if best_score.is_none_or(|s| score > s) {
            best = Some(TextSpan { start: at, end });
            best_score = Some(score);
        }
        next = index_of(&hay, &quote, at + 1);
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_rejects_blank() {
        let text = "Hello world, hello";
        let anchor = anchor_at(text, 6.0, 11.0).unwrap();
        assert_eq!(anchor.quote, "world");
        assert_eq!(
            locate_anchor(text, &anchor),
            Some(TextSpan { start: 6, end: 11 })
        );
        assert_eq!(anchor_at("a   b", 1.0, 4.0), None);
        assert_eq!(anchor_at("abc", 2.0, 2.0), None);
        assert_eq!(
            anchor_at("one two", 7.0, 4.0),
            anchor_at("one two", 4.0, 7.0)
        );
    }

    #[test]
    fn picks_occurrence_with_best_context() {
        let text = "the cat sat. the cat ran.";
        let second = text.rfind("cat").unwrap();
        let anchor = anchor_at(text, second as f64, (second + 3) as f64).unwrap();
        assert_eq!(
            locate_anchor(text, &anchor),
            Some(TextSpan {
                start: second,
                end: second + 3
            })
        );
    }

    #[test]
    fn span_points_walks_text_nodes() {
        let span = TextSpan { start: 3, end: 7 };
        assert_eq!(
            span_points(&[2, 4, 3], span),
            Some(SpanPoints {
                start: [1, 1],
                end: [2, 1]
            })
        );
        assert_eq!(
            span_points(&[3, 4], span),
            Some(SpanPoints {
                start: [0, 3],
                end: [1, 4]
            })
        );
        assert_eq!(span_points(&[2], span), None);
    }

    #[test]
    fn gone_quote_is_none_and_offsets_are_utf16() {
        let anchor = anchor_at("keep this sentence", 5.0, 9.0).unwrap();
        assert_eq!(locate_anchor("keep that sentence", &anchor), None);
        let text = "😀 word";
        let anchor = anchor_at(text, 3.0, 7.0).unwrap();
        assert_eq!(anchor.quote, "word");
        assert_eq!(
            locate_anchor(text, &anchor),
            Some(TextSpan { start: 3, end: 7 })
        );
    }
}
