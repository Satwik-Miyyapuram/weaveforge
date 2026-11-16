//! Citation underline planning: map mention offsets onto the page's text runs and split each run at
//! the mention boundaries. Port of `mentionItemRanges` and `planCitationSegments` in
//! `apps/web/src/features/reader/application/parts-1.ts`. The DOM rewrite stays in TS.

use serde::{Deserialize, Serialize};

use super::selection::SelectionPageTextItem;
use super::text_units::{as_f64, utf16_slice};
use crate::search::js_text::utf16_len;

/// The part of a mention the planner needs: where it is and what to call it (TS `CiteSpan`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CiteSpan {
    /// Stable key, shared by every piece of one mention.
    pub key: String,
    /// Start offset into the page text.
    pub start: f64,
    /// Exclusive end offset into the page text.
    pub end: f64,
    /// Printed text, when the caller has it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub text: Option<String>,
    /// Tooltip label, when the caller has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub label: Option<String>,
    /// `citation`, `figure` or `url`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub kind: Option<String>,
    /// External URL, for link mentions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub url: Option<String>,
}

/// One planned piece of an item's text (TS `TextSegment`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TextSegment {
    /// Item-local start offset, in UTF-16 units.
    pub from: f64,
    /// Item-local exclusive end offset.
    pub to: f64,
    /// The text of the piece.
    pub text: String,
    /// The mention the piece belongs to, when it is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub mention: Option<CiteSpan>,
}

/// Where a mention's text falls inside one item (TS `ItemRange`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "CitationItemRange"))]
pub struct ItemRange {
    /// Index of the item in the page's list.
    pub item_index: f64,
    /// Item-local start offset.
    pub from: f64,
    /// Item-local exclusive end offset.
    pub to: f64,
}

/// Maps a mention's page offsets onto the runs it covers. The page text is the items concatenated,
/// with a newline after each `hasEOL` item.
#[must_use]
pub fn mention_item_ranges(
    items: &[SelectionPageTextItem],
    start: f64,
    end: f64,
) -> Vec<ItemRange> {
    if !start.is_finite() || !end.is_finite() || end <= start {
        return Vec::new();
    }
    let mut ranges = Vec::new();
    let mut cursor = 0.0_f64;
    for (item_index, item) in items.iter().enumerate() {
        let len = as_f64(utf16_len(&item.str));
        let from = cursor;
        let to = from + len;
        cursor = to + if item.has_eol == Some(true) { 1.0 } else { 0.0 };
        if to <= start || from >= end || len == 0.0 {
            continue;
        }
        ranges.push(ItemRange {
            item_index: as_f64(item_index),
            from: (start - from).max(0.0),
            to: (end - from).min(len),
        });
    }
    ranges
}

/// A mention's piece inside one item, referring to the mention by index.
struct Piece {
    from: f64,
    to: f64,
    mention: usize,
}

/// Splits each item's text at every mention boundary inside it. Mentions with non-integer or
/// out-of-range offsets are skipped.
#[must_use]
pub fn plan_citation_segments(
    items: &[SelectionPageTextItem],
    mentions: &[CiteSpan],
) -> Vec<Vec<TextSegment>> {
    let length: f64 = items
        .iter()
        .map(|item| {
            as_f64(utf16_len(&item.str)) + if item.has_eol == Some(true) { 1.0 } else { 0.0 }
        })
        .sum();
    let mut by_item: Vec<Vec<Piece>> = items.iter().map(|_| Vec::new()).collect();
    for (mention_index, mention) in mentions.iter().enumerate() {
        if !is_integer(mention.start)
            || !is_integer(mention.end)
            || mention.start < 0.0
            || mention.end > length
        {
            continue;
        }
        for range in mention_item_ranges(items, mention.start, mention.end) {
            let index = to_index(range.item_index);
            if let Some(list) = by_item.get_mut(index) {
                list.push(Piece {
                    from: range.from,
                    to: range.to,
                    mention: mention_index,
                });
            }
        }
    }
    items
        .iter()
        .enumerate()
        .map(|(item_index, item)| {
            let mut ranges = by_item.get(item_index).map_or_else(Vec::new, |list| {
                list.iter()
                    .map(|piece| Piece {
                        from: piece.from,
                        to: piece.to,
                        mention: piece.mention,
                    })
                    .collect()
            });
            ranges.sort_by(|a, b| a.from.total_cmp(&b.from).then(b.to.total_cmp(&a.to)));
            segments_for(&item.str, &ranges, mentions)
        })
        .collect()
}

/// Builds one item's segments from its sorted pieces, merging neighbours that share a mention.
fn segments_for(text: &str, ranges: &[Piece], mentions: &[CiteSpan]) -> Vec<TextSegment> {
    let mut boundaries = vec![0.0, as_f64(utf16_len(text))];
    for range in ranges {
        boundaries.push(range.from);
        boundaries.push(range.to);
    }
    boundaries.sort_by(f64::total_cmp);
    boundaries.dedup();

    let mut segments: Vec<TextSegment> = Vec::new();
    for pair in boundaries.windows(2) {
        let (from, to) = (pair[0], pair[1]);
        if to <= from {
            continue;
        }
        let mention = ranges
            .iter()
            .find(|range| range.from <= from && range.to >= to)
            .map(|range| range.mention);
        let piece_text = utf16_slice(text, from, to);
        let mention_key = mention.map(|index| mentions[index].key.as_str());
        if let Some(previous) = segments.last_mut()
            && previous.mention.as_ref().map(|m| m.key.as_str()) == mention_key
        {
            previous.to = to;
            previous.text.push_str(&piece_text);
        } else {
            segments.push(TextSegment {
                from,
                to,
                text: piece_text,
                mention: mention.map(|index| mentions[index].clone()),
            });
        }
    }
    segments
}

/// `Number.isInteger` for an offset.
fn is_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0
}

/// An offset that [`mention_item_ranges`] produced from an item index, back to a list index.
pub(super) fn to_index(value: f64) -> usize {
    // Item indexes are small non-negative whole numbers, so the cast is exact.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let index = value as usize;
    index
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    fn item(text: &str, has_eol: Option<bool>) -> SelectionPageTextItem {
        SelectionPageTextItem {
            str: text.to_owned(),
            transform: vec![10.0, 0.0, 0.0, 10.0, 72.0, 700.0],
            width: Some(40.0),
            height: Some(10.0),
            has_eol,
            font_name: None,
        }
    }

    /// Page text is `"see [12]and\n[13]"`: item 0 is 0-8, item 1 is 8-11, newline 11, item 2 is 12-16.
    fn page() -> Vec<SelectionPageTextItem> {
        vec![
            item("see [12]", None),
            item("and", Some(true)),
            item("[13]", None),
        ]
    }

    fn mention(key: &str, start: f64, end: f64) -> CiteSpan {
        CiteSpan {
            key: key.to_owned(),
            start,
            end,
            text: None,
            label: None,
            kind: None,
            url: None,
        }
    }

    fn pieces(segments: &[TextSegment]) -> Vec<(&str, Option<&str>)> {
        segments
            .iter()
            .map(|s| (s.text.as_str(), s.mention.as_ref().map(|m| m.key.as_str())))
            .collect()
    }

    fn joined(segments: &[TextSegment]) -> String {
        segments.iter().map(|s| s.text.as_str()).collect()
    }

    #[test]
    fn a_mention_maps_onto_the_runs_it_covers() {
        let items = page();
        assert_eq!(
            mention_item_ranges(&items, 4.0, 8.0),
            vec![ItemRange {
                item_index: 0.0,
                from: 4.0,
                to: 8.0
            }]
        );
        assert_eq!(
            mention_item_ranges(&items, 6.0, 10.0),
            vec![
                ItemRange {
                    item_index: 0.0,
                    from: 6.0,
                    to: 8.0
                },
                ItemRange {
                    item_index: 1.0,
                    from: 0.0,
                    to: 2.0
                },
            ]
        );
    }

    #[test]
    fn an_empty_or_inverted_range_maps_to_nothing() {
        let items = page();
        assert!(mention_item_ranges(&items, 5.0, 5.0).is_empty());
        assert!(mention_item_ranges(&items, 8.0, 4.0).is_empty());
        assert!(mention_item_ranges(&items, f64::NAN, 4.0).is_empty());
    }

    #[test]
    fn splitting_one_run_leaves_the_other_pieces_as_plain_text() {
        let items = page();
        let plan = plan_citation_segments(&items, &[mention("c1", 4.0, 8.0)]);
        assert_eq!(pieces(&plan[0]), vec![("see ", None), ("[12]", Some("c1"))]);
    }

    #[test]
    fn a_mention_crossing_a_line_break_marks_both_runs() {
        let items = page();
        let plan = plan_citation_segments(&items, &[mention("c1", 6.0, 10.0)]);
        assert_eq!(pieces(&plan[0]), vec![("see [1", None), ("2]", Some("c1"))]);
        assert_eq!(pieces(&plan[1]), vec![("an", Some("c1")), ("d", None)]);
        assert_eq!(joined(&plan[2]), "[13]");
    }

    #[test]
    fn decorating_never_loses_or_invents_a_character() {
        let items = page();
        let mentions = [
            mention("a", 4.0, 8.0),
            mention("b", 0.0, 3.0),
            mention("c", 6.0, 10.0),
        ];
        let plan = plan_citation_segments(&items, &mentions);
        for (segments, item) in plan.iter().zip(&items) {
            assert_eq!(joined(segments), item.str);
        }
        let page_text: String = plan.iter().flatten().map(|s| s.text.as_str()).collect();
        assert_eq!(page_text, "see [12]and[13]");
    }

    #[test]
    fn overlapping_mentions_do_not_both_claim_a_character() {
        let items = page();
        let mentions = [mention("a", 4.0, 8.0), mention("b", 5.0, 12.0)];
        let plan = plan_citation_segments(&items, &mentions);
        for (segments, item) in plan.iter().zip(&items) {
            assert_eq!(joined(segments), item.str);
        }
    }

    #[test]
    fn a_mention_reaching_past_the_page_text_is_ignored() {
        let items = page();
        let plan = plan_citation_segments(&items, &[mention("bogus", 0.0, 9999.0)]);
        assert_eq!(joined(&plan[0]), "see [12]");
        assert_eq!(pieces(&plan[0]), vec![("see [12]", None)]);
    }

    #[test]
    fn url_and_figure_mentions_are_included_in_the_plan() {
        let items = page();
        let url = CiteSpan {
            key: "u1".to_owned(),
            start: 4.0,
            end: 8.0,
            text: None,
            label: None,
            kind: Some("url".to_owned()),
            url: Some("https://example.com".to_owned()),
        };
        let figure = CiteSpan {
            key: "f1".to_owned(),
            start: 12.0,
            end: 16.0,
            text: None,
            label: None,
            kind: Some("figure".to_owned()),
            url: None,
        };
        let plan = plan_citation_segments(&items, &[url, figure]);
        let link = plan[0][1].mention.as_ref();
        assert_eq!(link.and_then(|m| m.kind.as_deref()), Some("url"));
        assert_eq!(
            link.and_then(|m| m.url.as_deref()),
            Some("https://example.com")
        );
        assert_eq!(
            plan[2][0].mention.as_ref().and_then(|m| m.kind.as_deref()),
            Some("figure")
        );
    }
}
