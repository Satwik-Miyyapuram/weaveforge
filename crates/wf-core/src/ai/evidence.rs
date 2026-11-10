//! Splits an excerpt around the span a PDF locus points at (TS `ai-evidence.ts` `highlightWithinExcerpt`).

use crate::reader::anchor::{resolve_text_anchor, AnchorConfidence, AnchorPdfLocus};
use crate::reader::text_units::utf16_slice;

/// An excerpt split around its matched span (TS `ExcerptHighlight`). The offsets are UTF-16, so the three parts join back to the excerpt.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ExcerptHighlight {
    /// Text before the matched span.
    pub before: String,
    /// The matched span (TS `match`).
    #[serde(rename = "match")]
    pub matched: String,
    /// Text after the matched span.
    pub after: String,
    /// Trust in the match.
    pub confidence: AnchorConfidence,
}

/// Splits `excerpt` into before, match and after around the span `locus` resolves to.
/// `None` when there is no excerpt, no locus, or the locus does not resolve.
#[must_use]
pub fn highlight_within_excerpt(
    excerpt: &str,
    locus: Option<&AnchorPdfLocus>,
) -> Option<ExcerptHighlight> {
    if excerpt.is_empty() {
        return None;
    }
    let anchor = resolve_text_anchor(excerpt, locus?)?;
    Some(ExcerptHighlight {
        before: utf16_slice(excerpt, 0.0, anchor.start),
        matched: utf16_slice(excerpt, anchor.start, anchor.end),
        after: utf16_slice(excerpt, anchor.end, f64::INFINITY),
        confidence: anchor.confidence,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader::anchor::{AnchorPositionSelector, AnchorQuoteSelector};

    const EXCERPT: &str = "Prior work established the baseline. We show attention is all you need. Later sections expand on this.";

    fn quote(exact: &str) -> AnchorPdfLocus {
        AnchorPdfLocus {
            quote: AnchorQuoteSelector {
                kind: Some("TextQuoteSelector".into()),
                exact: Some(exact.into()),
                ..AnchorQuoteSelector::default()
            },
            position: None,
        }
    }

    #[test]
    fn splits_the_excerpt_around_the_used_sentence() {
        let hl = highlight_within_excerpt(EXCERPT, Some(&quote("attention is all you need")))
            .expect("quote is present");
        assert_eq!(hl.matched, "attention is all you need");
        assert_eq!(format!("{}{}{}", hl.before, hl.matched, hl.after), EXCERPT);
        assert_eq!(hl.confidence, AnchorConfidence::High);
    }

    #[test]
    fn reports_low_confidence_for_an_ambiguous_quote() {
        let hl = highlight_within_excerpt("the model. the model. the model.", Some(&quote("the model")))
            .expect("quote is present");
        assert_eq!(hl.confidence, AnchorConfidence::Low);
    }

    #[test]
    fn returns_none_without_excerpt_locus_or_match() {
        assert_eq!(highlight_within_excerpt("", Some(&quote("x"))), None);
        assert_eq!(highlight_within_excerpt(EXCERPT, None), None);
        assert_eq!(
            highlight_within_excerpt(EXCERPT, Some(&quote("not present here"))),
            None
        );
    }

    #[test]
    fn falls_back_to_a_position_selector_at_low_confidence() {
        let locus = AnchorPdfLocus {
            quote: AnchorQuoteSelector {
                kind: Some("TextQuoteSelector".into()),
                exact: Some("totally absent phrase".into()),
                ..AnchorQuoteSelector::default()
            },
            position: Some(AnchorPositionSelector {
                kind: Some("TextPositionSelector".into()),
                start: Some(0.0),
                end: Some(10.0),
            }),
        };
        let hl = highlight_within_excerpt(EXCERPT, Some(&locus)).expect("position fallback");
        assert_eq!(hl.confidence, AnchorConfidence::Low);
        assert_eq!(hl.matched, &EXCERPT[..10]);
    }
}
