//! Text and geometry anchor resolution for PDF annotations. A faithful port of
//! `packages/core/src/reader/anchor-resolution.ts` and
//! `packages/core/src/reader/anchor-strategy.ts`.
//!
//! Stays in TS: `resolveTextAnchor` callers that read `pdf.js` page text, and any
//! code that takes DOM elements, Promises or injected clients.

// A port of JS number code: offsets are UTF-16 code units held as f64, and
// index casts mirror JS numbers used as indices, all bounded by slice lengths.
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_lossless,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]

use crate::search::js_text::{is_js_whitespace, utf16_len};
use serde::{Deserialize, Serialize};

const SOFT_HYPHEN: u16 = 0x00AD;
const SPACE: u16 = 0x0020;

/// Character span in extracted text, as UTF-16 offsets (TS `TextSpan`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnchorTextSpan {
    /// UTF-16 start offset.
    pub start: f64,
    /// UTF-16 exclusive end offset.
    pub end: f64,
}

/// `high` or `low` (TS `AnchorConfidence`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum AnchorConfidence {
    /// Quote matched (unique or disambiguated) or rects trusted.
    High,
    /// Position fallback, ambiguous quote, or quote-only strategy.
    Low,
}

/// How a span was obtained (TS `ResolvedAnchor.via`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum AnchorVia {
    /// Matched by quote.
    Quote,
    /// Position fallback.
    Position,
}

/// A resolved span with provenance (TS `ResolvedAnchor`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnchorResolved {
    /// UTF-16 start offset.
    pub start: f64,
    /// UTF-16 exclusive end offset.
    pub end: f64,
    /// How the span was obtained.
    pub via: AnchorVia,
    /// Trust level of the span.
    pub confidence: AnchorConfidence,
}

/// Output of `normaliseWhitespace` (TS return value).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnchorNormalised {
    /// Whitespace-collapsed text.
    pub normalised: String,
    /// `map[i]` is the UTF-16 offset in the original of normalised unit `i`;
    /// `map[normalised.length]` is the exclusive end.
    pub map: Vec<f64>,
}

/// `normaliseWhitespace` options (TS `NormaliseWhitespaceOptions`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnchorNormaliseOptions {
    /// Absent or `true` trims; `false` keeps boundary whitespace.
    pub trim: Option<bool>,
}

/// W3C TextQuoteSelector (TS `TextQuoteSelector`). A missing `exact` acts as `""`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnchorQuoteSelector {
    /// Selector type tag, kept so round-trips keep it.
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// Text to find.
    #[serde(default)]
    pub exact: Option<String>,
    /// Text required immediately before `exact`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
    /// Text required immediately after `exact`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
}

/// W3C TextPositionSelector (TS `TextPositionSelector`). Missing bounds are NaN.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnchorPositionSelector {
    /// Selector type tag, kept so round-trips keep it.
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// UTF-16 start offset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<f64>,
    /// UTF-16 exclusive end offset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end: Option<f64>,
}

/// Stored locus (TS `PdfLocus`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnchorPdfLocus {
    /// Quote selector.
    #[serde(default)]
    pub quote: AnchorQuoteSelector,
    /// Optional position fallback.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<AnchorPositionSelector>,
}

/// Zotero `annotationPosition` (TS `ZoteroRectPosition`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnchorZoteroPosition {
    /// Zero-based page index; must be a non-negative integer to be usable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_index: Option<f64>,
    /// PDF user-space rects `[x1, y1, x2, y2]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rects: Option<Vec<Vec<f64>>>,
    /// Ink strokes as flat point lists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<Vec<f64>>>,
    /// Nib width for `paths`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    /// Tail of a highlight that crosses onto the next page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_page_rects: Option<Vec<Vec<f64>>>,
}

/// Dual anchor (TS `CombinedPdfAnchor`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnchorCombinedPdf {
    /// Hash of the PDF the rects were captured against.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub content_hash: Option<String>,
    /// Zotero rects.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = AnchorZoteroPosition))]
    pub zotero_position: Option<AnchorZoteroPosition>,
    /// W3C locus.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = AnchorPdfLocus))]
    pub locus: Option<AnchorPdfLocus>,
}

/// Which anchor to trust (TS `AnchorStrategy`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum AnchorStrategy {
    /// Trust the Zotero rects.
    Rects {
        /// The position to render.
        position: AnchorZoteroPosition,
        /// Always high.
        confidence: AnchorConfidence,
    },
    /// Re-resolve the quote.
    Quote {
        /// The locus to resolve.
        locus: AnchorPdfLocus,
        /// Always low.
        confidence: AnchorConfidence,
    },
    /// Nothing usable.
    None {
        /// Always low.
        confidence: AnchorConfidence,
    },
}

/// Whether a JS number is an integer (`Number.isInteger`).
fn is_js_integer(x: f64) -> bool {
    x.is_finite() && x.trunc() == x
}

/// UTF-16 code units of `s`.
fn units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// The JS whitespace set on one UTF-16 code unit (`/\s/u` on a single unit).
fn is_space_unit(u: u16) -> bool {
    char::from_u32(u32::from(u)).is_some_and(is_js_whitespace)
}

/// Whitespace that normalisation collapses: `\s`, or a soft hyphen before a line break.
fn is_normalisable(text: &[u16], index: usize) -> bool {
    let Some(&ch) = text.get(index) else {
        return false;
    };
    if is_space_unit(ch) {
        return true;
    }
    ch == SOFT_HYPHEN && matches!(text.get(index + 1), Some(&0x000A | &0x000D))
}

/// Collapse whitespace runs to one space. Returns the normalised units and the
/// original UTF-16 offset of each unit, plus the exclusive end at `len`.
fn normalise_units(text: &[u16], trim: bool) -> (Vec<u16>, Vec<usize>) {
    let mut map = Vec::new();
    let mut out = Vec::new();
    let mut i = 0;

    if trim {
        while i < text.len() && is_normalisable(text, i) {
            i += 1;
        }
    }

    // Exclusive end for a span covering all normalised units; excludes trimmed trailing whitespace.
    let mut end_in_original = i;

    while i < text.len() {
        if is_normalisable(text, i) {
            let run_start = i;
            while i < text.len() && is_normalisable(text, i) {
                i += 1;
            }
            let at_end = i >= text.len();
            if at_end && trim {
                continue;
            }
            map.push(run_start);
            out.push(SPACE);
            if !at_end {
                continue;
            }
            end_in_original = i;
            break;
        }
        map.push(i);
        out.push(text[i]);
        i += 1;
        end_in_original = i;
    }

    map.push(end_in_original);
    (out, map)
}

/// Trim JS whitespace (`String.prototype.trim`), which differs from Rust `str::trim`.
fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// Collapse whitespace runs to a single space; `map[i]` is the original UTF-16
/// offset of normalised unit `i`, and `map[normalised.len()]` the exclusive end.
/// Port of TS `normaliseWhitespace`.
#[must_use]
pub fn normalise_whitespace(text: &str, options: AnchorNormaliseOptions) -> AnchorNormalised {
    let trim = options.trim != Some(false);
    let (out, map) = normalise_units(&units(text), trim);
    AnchorNormalised {
        normalised: String::from_utf16_lossy(&out),
        map: map.into_iter().map(|offset| offset as f64).collect(),
    }
}

/// First index `>= from` where `needle` occurs in `hay`.
fn index_of(hay: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if needle.is_empty() {
        return (from <= hay.len()).then_some(from);
    }
    if needle.len() > hay.len() {
        return None;
    }
    (from..=hay.len() - needle.len()).find(|&s| hay[s..s + needle.len()] == *needle)
}

/// Every occurrence of `quote.exact` whose immediate prefix/suffix match, as
/// UTF-16 spans into the original text. Port of TS `findQuoteMatches`.
#[must_use]
pub fn find_quote_matches(text: &str, quote: &AnchorQuoteSelector) -> Vec<AnchorTextSpan> {
    let exact = normalise_units(&units(quote.exact.as_deref().unwrap_or("")), true).0;
    if exact.is_empty() {
        return Vec::new();
    }

    let (norm, map) = normalise_units(&units(text), true);
    // Affix spaces abutting `exact` must survive, so they are not trimmed.
    let prefix = quote
        .prefix
        .as_deref()
        .map_or_else(Vec::new, |p| normalise_units(&units(p), false).0);
    let suffix = quote
        .suffix
        .as_deref()
        .map_or_else(Vec::new, |s| normalise_units(&units(s), false).0);

    let mut matches = Vec::new();
    let mut from = 0;
    while let Some(start) = index_of(&norm, &exact, from) {
        let end = start + exact.len();
        from = start + 1;
        let prefix_ok = prefix.is_empty()
            || (start >= prefix.len() && norm[start - prefix.len()..start] == prefix[..]);
        let suffix_ok = suffix.is_empty()
            || (end + suffix.len() <= norm.len() && norm[end..end + suffix.len()] == suffix[..]);
        if !prefix_ok || !suffix_ok {
            continue;
        }
        matches.push(AnchorTextSpan {
            start: map[start] as f64,
            end: map[end] as f64,
        });
    }
    matches
}

/// The match whose `start` is nearest `position.start`; ties keep the first.
/// Port of TS `pickNearestMatch`.
#[must_use]
pub fn pick_nearest_match(
    matches: &[AnchorTextSpan],
    position: Option<&AnchorPositionSelector>,
) -> Option<AnchorTextSpan> {
    let first = *matches.first()?;
    let Some(position) = position.filter(|_| matches.len() > 1) else {
        return Some(first);
    };
    let target = position.start.unwrap_or(f64::NAN);
    let mut best = first;
    let mut best_dist = (first.start - target).abs();
    for m in &matches[1..] {
        let dist = (m.start - target).abs();
        if dist < best_dist {
            best = *m;
            best_dist = dist;
        }
    }
    Some(best)
}

/// The position span when its bounds are finite, ordered, and inside `text`.
/// Port of TS `resolvePositionSelector`.
#[must_use]
pub fn resolve_position_selector(
    text: &str,
    position: &AnchorPositionSelector,
) -> Option<AnchorTextSpan> {
    let (Some(start), Some(end)) = (position.start, position.end) else {
        return None;
    };
    let len = utf16_len(text) as f64;
    if !start.is_finite() || !end.is_finite() || start < 0.0 || end < start || end > len {
        return None;
    }
    Some(AnchorTextSpan { start, end })
}

/// Resolve a locus: quote first (nearest-position disambiguation), then position.
/// Never panics. Port of TS `resolveTextAnchor`.
#[must_use]
pub fn resolve_text_anchor(text: &str, locus: &AnchorPdfLocus) -> Option<AnchorResolved> {
    let matches = find_quote_matches(text, &locus.quote);
    let usable = locus
        .position
        .as_ref()
        .filter(|p| resolve_position_selector(text, p).is_some());
    if let Some(picked) = pick_nearest_match(&matches, usable) {
        let ambiguous = matches.len() > 1 && usable.is_none();
        return Some(AnchorResolved {
            start: picked.start,
            end: picked.end,
            via: AnchorVia::Quote,
            confidence: if ambiguous {
                AnchorConfidence::Low
            } else {
                AnchorConfidence::High
            },
        });
    }
    usable
        .and_then(|p| resolve_position_selector(text, p))
        .map(|span| AnchorResolved {
            start: span.start,
            end: span.end,
            via: AnchorVia::Position,
            confidence: AnchorConfidence::Low,
        })
}

/// True when `lists` has a list whose first `min` entries are all finite.
fn any_usable(lists: Option<&[Vec<f64>]>, min: usize) -> bool {
    lists.is_some_and(|lists| {
        lists
            .iter()
            .any(|list| list.len() >= min && list[..min].iter().all(|n| n.is_finite()))
    })
}

/// Renderable geometry: a valid page index and usable rects, next-page rects or paths.
fn has_usable_geometry(position: &AnchorZoteroPosition) -> bool {
    if !matches!(position.page_index, Some(i) if is_js_integer(i) && i >= 0.0) {
        return false;
    }
    any_usable(position.rects.as_deref(), 4)
        || any_usable(position.next_page_rects.as_deref(), 4)
        || any_usable(position.paths.as_deref(), 4)
}

/// The quote has non-blank `exact` text after whitespace normalisation.
fn has_usable_quote(locus: &AnchorPdfLocus) -> bool {
    locus
        .quote
        .exact
        .as_deref()
        .is_some_and(|exact| !normalise_units(&units(exact), true).0.is_empty())
}

/// Which anchor to trust for the current PDF. Rects only when hashes match (both empty counts).
/// Port of TS `chooseAnchorStrategy`.
#[must_use]
pub fn choose_anchor_strategy(
    anchor: &AnchorCombinedPdf,
    current_content_hash: &str,
) -> AnchorStrategy {
    let capture = js_trim(anchor.content_hash.as_deref().unwrap_or(""));
    let current = js_trim(current_content_hash);
    let both_empty = capture.is_empty() && current.is_empty();
    let hash_matches =
        both_empty || (!capture.is_empty() && !current.is_empty() && capture == current);

    if let Some(position) = anchor
        .zotero_position
        .as_ref()
        .filter(|p| hash_matches && has_usable_geometry(p))
    {
        return AnchorStrategy::Rects {
            position: position.clone(),
            confidence: AnchorConfidence::High,
        };
    }

    if let Some(locus) = anchor.locus.as_ref().filter(|l| has_usable_quote(l)) {
        return AnchorStrategy::Quote {
            locus: locus.clone(),
            confidence: AnchorConfidence::Low,
        };
    }

    AnchorStrategy::None {
        confidence: AnchorConfidence::Low,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quote(exact: &str) -> AnchorQuoteSelector {
        AnchorQuoteSelector {
            kind: Some("TextQuoteSelector".to_owned()),
            exact: Some(exact.to_owned()),
            ..Default::default()
        }
    }

    fn quote_with(exact: &str, prefix: Option<&str>, suffix: Option<&str>) -> AnchorQuoteSelector {
        AnchorQuoteSelector {
            prefix: prefix.map(str::to_owned),
            suffix: suffix.map(str::to_owned),
            ..quote(exact)
        }
    }

    fn position(start: f64, end: f64) -> AnchorPositionSelector {
        AnchorPositionSelector {
            kind: Some("TextPositionSelector".to_owned()),
            start: Some(start),
            end: Some(end),
        }
    }

    fn span(start: f64, end: f64) -> AnchorTextSpan {
        AnchorTextSpan { start, end }
    }

    fn locus(exact: &str) -> AnchorPdfLocus {
        AnchorPdfLocus {
            quote: quote(exact),
            position: None,
        }
    }

    fn slice16(text: &str, start: f64, end: f64) -> String {
        let u = units(text);
        String::from_utf16_lossy(&u[start as usize..end as usize])
    }

    fn norm(text: &str) -> AnchorNormalised {
        normalise_whitespace(text, AnchorNormaliseOptions::default())
    }

    fn norm_untrimmed(text: &str) -> AnchorNormalised {
        normalise_whitespace(text, AnchorNormaliseOptions { trim: Some(false) })
    }

    fn resolved(
        start: f64,
        end: f64,
        via: AnchorVia,
        confidence: AnchorConfidence,
    ) -> AnchorResolved {
        AnchorResolved {
            start,
            end,
            via,
            confidence,
        }
    }

    #[test]
    fn find_quote_matches_returns_every_exact_occurrence() {
        let text = "alpha beta alpha gamma";
        assert_eq!(
            find_quote_matches(text, &quote("alpha")),
            vec![span(0.0, 5.0), span(11.0, 16.0)]
        );
    }

    #[test]
    fn find_quote_matches_applies_prefix_and_suffix_constraints() {
        let text = "xx foo yy foo zz";
        assert_eq!(
            find_quote_matches(text, &quote_with("foo", Some("xx "), Some(" yy"))),
            vec![span(3.0, 6.0)]
        );
        assert_eq!(
            find_quote_matches(text, &quote_with("foo", Some("yy "), Some(" zz"))),
            vec![span(10.0, 13.0)]
        );
    }

    #[test]
    fn find_quote_matches_returns_empty_for_blank_exact_or_no_hit() {
        assert!(find_quote_matches("hello", &quote("")).is_empty());
        assert!(find_quote_matches("hello", &quote("nope")).is_empty());
    }

    #[test]
    fn pick_nearest_match_chooses_span_closest_to_position_start() {
        let matches = [span(0.0, 5.0), span(40.0, 45.0), span(80.0, 85.0)];
        assert_eq!(
            pick_nearest_match(&matches, Some(&position(42.0, 47.0))),
            Some(span(40.0, 45.0))
        );
        assert_eq!(
            pick_nearest_match(&matches, Some(&position(10.0, 15.0))),
            Some(span(0.0, 5.0))
        );
    }

    #[test]
    fn pick_nearest_match_keeps_first_on_equal_distance_and_without_position() {
        let matches = [span(10.0, 15.0), span(30.0, 35.0)];
        assert_eq!(
            pick_nearest_match(&matches, Some(&position(20.0, 25.0))),
            Some(span(10.0, 15.0))
        );
        assert_eq!(pick_nearest_match(&matches, None), Some(span(10.0, 15.0)));
        assert_eq!(pick_nearest_match(&[], Some(&position(0.0, 1.0))), None);
    }

    #[test]
    fn resolve_position_selector_accepts_in_bounds_spans_and_rejects_bad_ones() {
        let text = "abcdefghij";
        assert_eq!(
            resolve_position_selector(text, &position(2.0, 5.0)),
            Some(span(2.0, 5.0))
        );
        assert_eq!(
            resolve_position_selector(text, &position(0.0, 10.0)),
            Some(span(0.0, 10.0))
        );
        assert_eq!(resolve_position_selector(text, &position(5.0, 4.0)), None);
        assert_eq!(resolve_position_selector(text, &position(-1.0, 2.0)), None);
        assert_eq!(resolve_position_selector(text, &position(0.0, 11.0)), None);
    }

    #[test]
    fn resolve_text_anchor_prefers_quote_match_with_high_confidence() {
        let text = "The latent space encodes structure.";
        let locus = AnchorPdfLocus {
            quote: quote_with("latent space", Some("The "), Some(" encodes")),
            position: Some(position(99.0, 111.0)),
        };
        assert_eq!(
            resolve_text_anchor(text, &locus),
            Some(resolved(
                4.0,
                16.0,
                AnchorVia::Quote,
                AnchorConfidence::High
            ))
        );
    }

    #[test]
    fn resolve_text_anchor_disambiguates_multiple_quote_hits_via_position() {
        let text = "foo one foo two foo three";
        let locus = AnchorPdfLocus {
            quote: quote("foo"),
            position: Some(position(8.0, 11.0)),
        };
        assert_eq!(
            resolve_text_anchor(text, &locus),
            Some(resolved(
                8.0,
                11.0,
                AnchorVia::Quote,
                AnchorConfidence::High
            ))
        );
    }

    #[test]
    fn resolve_text_anchor_falls_back_to_position_with_low_confidence() {
        let text = "abcdefghij";
        let locus = AnchorPdfLocus {
            quote: quote("missing"),
            position: Some(position(2.0, 6.0)),
        };
        assert_eq!(
            resolve_text_anchor(text, &locus),
            Some(resolved(
                2.0,
                6.0,
                AnchorVia::Position,
                AnchorConfidence::Low
            ))
        );
    }

    #[test]
    fn resolve_text_anchor_returns_none_when_neither_quote_nor_position_works() {
        let text = "short";
        let locus = AnchorPdfLocus {
            quote: quote("absent"),
            position: Some(position(0.0, 99.0)),
        };
        assert_eq!(resolve_text_anchor(text, &locus), None);
        assert_eq!(
            resolve_text_anchor(
                text,
                &AnchorPdfLocus {
                    quote: quote("absent"),
                    position: None
                }
            ),
            None
        );
    }

    #[test]
    fn find_quote_matches_matches_across_a_newline_mid_phrase() {
        let text = "the latent\nspace encodes";
        let span_found = find_quote_matches(text, &quote("latent space"));
        assert_eq!(span_found, vec![span(4.0, 16.0)]);
        assert_eq!(
            slice16(text, span_found[0].start, span_found[0].end),
            "latent\nspace"
        );
    }

    #[test]
    fn find_quote_matches_matches_when_text_has_doubled_spaces() {
        let text = "latent  space";
        let span_found = find_quote_matches(text, &quote("latent space"));
        assert_eq!(span_found, vec![span(0.0, 13.0)]);
        assert_eq!(
            slice16(text, span_found[0].start, span_found[0].end),
            "latent  space"
        );
    }

    #[test]
    fn find_quote_matches_ignores_leading_and_trailing_whitespace_differences() {
        let text = "  latent space  ";
        let span_found = find_quote_matches(text, &quote("  latent space  "));
        assert_eq!(span_found, vec![span(2.0, 14.0)]);
        assert_eq!(
            slice16(text, span_found[0].start, span_found[0].end),
            "latent space"
        );
    }

    #[test]
    fn find_quote_matches_returns_spans_into_the_original_non_normalised_text() {
        let text = "alpha\tbeta\ngamma";
        let span_found = find_quote_matches(text, &quote("beta gamma"));
        assert_eq!(span_found.len(), 1);
        let AnchorTextSpan { start, end } = span_found[0];
        assert_eq!(slice16(text, start, end), "beta\ngamma");
        assert_eq!(start, 6.0);
        assert_eq!(end, 16.0);
    }

    #[test]
    fn find_quote_matches_treats_soft_hyphen_at_line_end_as_whitespace() {
        let text = "exam\u{00AD}\nple theory";
        let span_found = find_quote_matches(text, &quote("exam ple"));
        assert_eq!(span_found, vec![span(0.0, 9.0)]);
        assert_eq!(slice16(text, 0.0, 9.0), "exam\u{00AD}\nple");
    }

    #[test]
    fn normalise_whitespace_builds_a_map_that_recovers_original_slices() {
        let text = "  foo\n\tbar  ";
        let out = norm(text);
        assert_eq!(out.normalised, "foo bar");
        assert_eq!(
            slice16(text, out.map[0], out.map[out.normalised.len()]),
            "foo\n\tbar"
        );
    }

    #[test]
    fn resolve_text_anchor_quote_path_still_wins_under_whitespace_drift() {
        let text = "The latent\nspace encodes structure.";
        let locus = AnchorPdfLocus {
            quote: quote_with("latent space", Some("The "), Some(" encodes")),
            position: Some(position(99.0, 111.0)),
        };
        let resolved_anchor = resolve_text_anchor(text, &locus);
        assert_eq!(
            resolved_anchor,
            Some(resolved(
                4.0,
                16.0,
                AnchorVia::Quote,
                AnchorConfidence::High
            ))
        );
        let r = resolved_anchor.expect("resolved");
        assert_eq!(slice16(text, r.start, r.end), "latent\nspace");
    }

    #[test]
    fn normalise_whitespace_trim_false_keeps_abutting_affix_spaces() {
        assert_eq!(norm_untrimmed("The ").normalised, "The ");
        assert_eq!(norm_untrimmed(" yy").normalised, " yy");
        assert_eq!(norm_untrimmed("  xx  ").normalised, " xx ");
    }

    #[test]
    fn resolve_text_anchor_marks_ambiguous_multi_match_without_position_as_low_confidence() {
        let text = "foo one foo two";
        assert_eq!(
            resolve_text_anchor(text, &locus("foo")),
            Some(resolved(0.0, 3.0, AnchorVia::Quote, AnchorConfidence::Low))
        );
    }

    #[test]
    fn normalise_whitespace_trim_false_map_preserves_kept_boundary_whitespace() {
        let text = "  xx  ";
        let out = norm_untrimmed(text);
        assert_eq!(out.normalised, " xx ");
        assert_eq!(
            slice16(text, out.map[0], out.map[out.normalised.len()]),
            "  xx  "
        );
    }

    #[test]
    fn resolve_text_anchor_treats_out_of_bounds_position_as_unusable_for_disambiguation() {
        let text = "foo one foo two";
        let locus = AnchorPdfLocus {
            quote: quote("foo"),
            position: Some(position(999.0, 1002.0)),
        };
        assert_eq!(
            resolve_text_anchor(text, &locus),
            Some(resolved(0.0, 3.0, AnchorVia::Quote, AnchorConfidence::Low))
        );
    }

    fn anchor_with_rects(
        hash: Option<&str>,
        position: AnchorZoteroPosition,
        locus: Option<AnchorPdfLocus>,
    ) -> AnchorCombinedPdf {
        AnchorCombinedPdf {
            content_hash: hash.map(str::to_owned),
            zotero_position: Some(position),
            locus,
        }
    }

    fn rects_at(page: f64, rects: Vec<Vec<f64>>) -> AnchorZoteroPosition {
        AnchorZoteroPosition {
            page_index: Some(page),
            rects: Some(rects),
            ..Default::default()
        }
    }

    #[test]
    fn choose_anchor_strategy_prefers_rects_when_content_hash_matches() {
        let anchor = anchor_with_rects(
            Some("abc"),
            rects_at(2.0, vec![vec![1.0, 2.0, 3.0, 4.0]]),
            Some(locus("latent space")),
        );
        assert_eq!(
            choose_anchor_strategy(&anchor, "abc"),
            AnchorStrategy::Rects {
                position: rects_at(2.0, vec![vec![1.0, 2.0, 3.0, 4.0]]),
                confidence: AnchorConfidence::High,
            }
        );
    }

    #[test]
    fn choose_anchor_strategy_falls_back_to_quote_with_low_confidence_on_hash_mismatch() {
        let quote_locus = locus("latent space");
        let anchor = anchor_with_rects(
            Some("old"),
            rects_at(0.0, vec![vec![0.0, 0.0, 1.0, 1.0]]),
            Some(quote_locus.clone()),
        );
        assert_eq!(
            choose_anchor_strategy(&anchor, "new"),
            AnchorStrategy::Quote {
                locus: quote_locus,
                confidence: AnchorConfidence::Low,
            }
        );
    }

    #[test]
    fn choose_anchor_strategy_uses_quote_when_rects_are_absent() {
        let quote_locus = locus("only quote");
        let anchor = AnchorCombinedPdf {
            content_hash: Some("abc".to_owned()),
            zotero_position: None,
            locus: Some(quote_locus.clone()),
        };
        assert_eq!(
            choose_anchor_strategy(&anchor, "abc"),
            AnchorStrategy::Quote {
                locus: quote_locus,
                confidence: AnchorConfidence::Low,
            }
        );
    }

    #[test]
    fn choose_anchor_strategy_returns_none_when_quote_absent_but_rects_hash_mismatches() {
        let anchor = anchor_with_rects(
            Some("old"),
            rects_at(1.0, vec![vec![0.0, 0.0, 10.0, 10.0]]),
            None,
        );
        assert_eq!(
            choose_anchor_strategy(&anchor, "new"),
            AnchorStrategy::None {
                confidence: AnchorConfidence::Low,
            }
        );
    }

    #[test]
    fn choose_anchor_strategy_returns_none_when_neither_rects_nor_quote_are_present() {
        assert_eq!(
            choose_anchor_strategy(&AnchorCombinedPdf::default(), "any"),
            AnchorStrategy::None {
                confidence: AnchorConfidence::Low,
            }
        );
        let blank = AnchorCombinedPdf {
            locus: Some(AnchorPdfLocus {
                quote: AnchorQuoteSelector {
                    exact: Some(String::new()),
                    ..Default::default()
                },
                position: None,
            }),
            ..Default::default()
        };
        assert_eq!(
            choose_anchor_strategy(&blank, "any"),
            AnchorStrategy::None {
                confidence: AnchorConfidence::Low,
            }
        );
    }

    #[test]
    fn choose_anchor_strategy_ignores_empty_or_missing_rect_arrays_even_when_hash_matches() {
        let quote_locus = locus("fallback quote");
        let expected = AnchorStrategy::Quote {
            locus: quote_locus.clone(),
            confidence: AnchorConfidence::Low,
        };
        let no_rects = AnchorZoteroPosition {
            page_index: Some(0.0),
            ..Default::default()
        };
        let empty_rects = rects_at(0.0, Vec::new());
        let empty_inner = rects_at(0.0, vec![Vec::new()]);
        let nan_rects = rects_at(0.0, vec![vec![f64::NAN; 4]]);
        let fractional_page = rects_at(1.5, vec![vec![1.0, 2.0, 3.0, 4.0]]);
        for position in [
            no_rects,
            empty_rects,
            empty_inner,
            nan_rects,
            fractional_page,
        ] {
            let anchor = anchor_with_rects(Some("abc"), position, Some(quote_locus.clone()));
            assert_eq!(choose_anchor_strategy(&anchor, "abc"), expected);
        }
    }

    #[test]
    fn choose_anchor_strategy_trusts_rects_when_both_hashes_are_empty_local_ann() {
        let anchor = anchor_with_rects(
            Some(""),
            rects_at(0.0, vec![vec![1.0, 2.0, 3.0, 4.0]]),
            Some(locus("quote")),
        );
        assert_eq!(
            choose_anchor_strategy(&anchor, ""),
            AnchorStrategy::Rects {
                position: rects_at(0.0, vec![vec![1.0, 2.0, 3.0, 4.0]]),
                confidence: AnchorConfidence::High,
            }
        );
        let blank_quote = AnchorCombinedPdf {
            locus: Some(locus("   ")),
            ..Default::default()
        };
        assert_eq!(
            choose_anchor_strategy(&blank_quote, "abc"),
            AnchorStrategy::None {
                confidence: AnchorConfidence::Low,
            }
        );
    }

    #[test]
    fn choose_anchor_strategy_does_not_trust_rects_when_only_one_hash_is_set() {
        let anchor = anchor_with_rects(
            Some("abc"),
            rects_at(0.0, vec![vec![1.0, 2.0, 3.0, 4.0]]),
            Some(locus("quote")),
        );
        assert_eq!(
            choose_anchor_strategy(&anchor, ""),
            AnchorStrategy::Quote {
                locus: locus("quote"),
                confidence: AnchorConfidence::Low,
            }
        );
    }

    #[test]
    fn choose_anchor_strategy_trusts_ink_paths_as_geometry_when_rects_are_absent() {
        let position = AnchorZoteroPosition {
            page_index: Some(3.0),
            paths: Some(vec![vec![10.0, 20.0, 30.0, 40.0]]),
            ..Default::default()
        };
        let anchor = anchor_with_rects(Some("abc"), position.clone(), None);
        assert_eq!(
            choose_anchor_strategy(&anchor, "abc"),
            AnchorStrategy::Rects {
                position,
                confidence: AnchorConfidence::High,
            }
        );
    }

    #[test]
    fn choose_anchor_strategy_trusts_a_next_page_rects_only_tail() {
        let anchor = AnchorCombinedPdf {
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(4.0),
                next_page_rects: Some(vec![vec![0.0, 700.0, 300.0, 720.0]]),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(matches!(
            choose_anchor_strategy(&anchor, ""),
            AnchorStrategy::Rects { .. }
        ));
    }

    #[test]
    fn choose_anchor_strategy_still_rejects_ink_paths_on_a_hash_mismatch() {
        let anchor = AnchorCombinedPdf {
            content_hash: Some("old".to_owned()),
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(0.0),
                paths: Some(vec![vec![1.0, 2.0, 3.0, 4.0]]),
                ..Default::default()
            }),
            locus: None,
        };
        assert_eq!(
            choose_anchor_strategy(&anchor, "new"),
            AnchorStrategy::None {
                confidence: AnchorConfidence::Low,
            }
        );
    }

    #[test]
    fn choose_anchor_strategy_rejects_malformed_paths() {
        let short = AnchorCombinedPdf {
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(0.0),
                paths: Some(vec![vec![1.0, 2.0]]),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(matches!(
            choose_anchor_strategy(&short, ""),
            AnchorStrategy::None { .. }
        ));
        let nan = AnchorCombinedPdf {
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(0.0),
                paths: Some(vec![vec![1.0, 2.0, f64::NAN, 4.0]]),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(matches!(
            choose_anchor_strategy(&nan, ""),
            AnchorStrategy::None { .. }
        ));
    }
}
