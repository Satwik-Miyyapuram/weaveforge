//! Split a search excerpt into plain and highlighted segments (TS
//! `excerpt-segments.ts`), so a renderer can mark matches without offset
//! arithmetic.
//!
//! Highlight offsets are UTF-16 code units, as in [`ExcerptRange`]. Slices
//! that split a surrogate pair decode to U+FFFD.

use crate::search::excerpt::ExcerptRange;

/// A snippet and its highlight ranges.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExcerptInput {
    /// Snippet text.
    pub text: String,
    /// Sorted highlight ranges into `text`, in UTF-16 units.
    pub highlights: Vec<ExcerptRange>,
}

/// A run of text, marked as highlighted or not.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExcerptSegment {
    /// The run's text.
    pub text: String,
    /// Whether the run is a highlight.
    pub highlighted: bool,
}

/// Alternating plain and highlighted segments covering the excerpt, with empty
/// runs dropped.
///
/// A highlight that starts before the previous one ended is cut from the
/// running position, as the TS did. Out-of-range offsets clamp to the text.
#[must_use]
pub fn excerpt_segments(excerpt: &ExcerptInput) -> Vec<ExcerptSegment> {
    let units: Vec<u16> = excerpt.text.encode_utf16().collect();
    let mut segments = Vec::new();
    let mut cursor = 0;
    for range in &excerpt.highlights {
        if range.start > cursor {
            segments.push(segment(&units, cursor, range.start, false));
        }
        segments.push(segment(&units, range.start, range.end, true));
        cursor = range.end;
    }
    if cursor < units.len() {
        segments.push(segment(&units, cursor, units.len(), false));
    }
    segments.retain(|run| !run.text.is_empty());
    segments
}

/// `units[start..end]` with JavaScript `slice` clamping.
fn segment(units: &[u16], start: usize, end: usize, highlighted: bool) -> ExcerptSegment {
    let start = start.min(units.len());
    let end = end.min(units.len());
    let text = if end > start {
        String::from_utf16_lossy(&units[start..end])
    } else {
        String::new()
    };
    ExcerptSegment { text, highlighted }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range(start: usize, end: usize) -> ExcerptRange {
        ExcerptRange { start, end }
    }

    fn run(text: &str, highlighted: bool) -> ExcerptSegment {
        ExcerptSegment {
            text: text.into(),
            highlighted,
        }
    }

    #[test]
    fn splits_plain_and_highlighted_runs() {
        let excerpt = ExcerptInput {
            text: "a fox b".into(),
            highlights: vec![range(2, 5)],
        };
        assert_eq!(
            excerpt_segments(&excerpt),
            vec![run("a ", false), run("fox", true), run(" b", false)]
        );
    }

    #[test]
    fn drops_empty_runs_and_keeps_leading_and_trailing_highlights() {
        let excerpt = ExcerptInput {
            text: "xy".into(),
            highlights: vec![range(0, 1), range(1, 2)],
        };
        assert_eq!(
            excerpt_segments(&excerpt),
            vec![run("x", true), run("y", true)]
        );
        let none = ExcerptInput {
            text: "x y".into(),
            highlights: vec![],
        };
        assert_eq!(excerpt_segments(&none), vec![run("x y", false)]);
        let empty = ExcerptInput {
            text: String::new(),
            highlights: vec![],
        };
        assert!(excerpt_segments(&empty).is_empty());
    }

    #[test]
    fn offsets_are_utf16_units() {
        // "😀" is two UTF-16 units; the highlight covers the "b".
        let excerpt = ExcerptInput {
            text: "😀b".into(),
            highlights: vec![range(2, 3)],
        };
        assert_eq!(
            excerpt_segments(&excerpt),
            vec![run("😀", false), run("b", true)]
        );
    }

    #[test]
    fn out_of_range_offsets_clamp() {
        let excerpt = ExcerptInput {
            text: "abc".into(),
            highlights: vec![range(1, 99)],
        };
        assert_eq!(
            excerpt_segments(&excerpt),
            vec![run("a", false), run("bc", true)]
        );
    }
}
