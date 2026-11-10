//! Citation underline planning: map mention offsets onto the page's text runs and split each run at
//! the mention boundaries. Port of `mentionItemRanges` and `planCitationSegments` in
//! `apps/web/src/features/reader/application/citation-spans.ts`. The DOM rewrite stays in TS.

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
