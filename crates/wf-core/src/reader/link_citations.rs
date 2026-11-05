//! Citation mentions from a page's internal `/Link` annotations. A faithful port of
//! packages/core/src/features/reader/link-citations.ts.
//!
//! Stays in TS: nothing here reads pdf.js or the DOM; page items and link boxes arrive as data.

// Offsets are UTF-16 code units held as f64, the TS number type; the casts map them to
// indexes and back, all bounded by the text length.
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::float_cmp
)]

use crate::ink::js_math;
use crate::reader::selection::{SelectionPageTextItem, item_to_rect};
use crate::reader_analysis::lines::js_trim;
use crate::reader_analysis::types::{
    AnalysisCitationMention, AnalysisLinkDest, AnalysisParsedReference, AnalysisPdfLink,
    AnalysisTextSpan,
};
use crate::search::js_text::{is_js_whitespace, utf16_len};
use serde::{Deserialize, Serialize};

/// One page's text items (TS `{ number, items }` argument of `coveredTextSpans`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct LinkCitationPage {
    /// 1-based page number.
    pub number: f64,
    /// Text items in reading order.
    pub items: Vec<SelectionPageTextItem>,
}

/// A span of page text one link covers (TS `CoveredTextSpan`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CoveredTextSpan {
    /// The link the span was measured from.
    pub link: AnalysisPdfLink,
    /// Start offset into the page text, trimmed of separators.
    pub start: f64,
    /// End offset into the page text, trimmed of separators.
    pub end: f64,
}

/// The spans a set of links cover, with the page text they index (TS `coveredTextSpans` result).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct CoveredTextSpans {
    /// One span per link that covers text, in link order.
    pub spans: Vec<CoveredTextSpan>,
    /// The page text: items concatenated, `\n` after each `hasEOL` item.
    pub text: String,
}

/// A text item with content and a box, as the proportional estimate sees it.
struct Row {
    /// UTF-16 offset of the item in the page text.
    start: f64,
    /// UTF-16 length of the item's text.
    len: f64,
    /// `[x1, y1, x2, y2]` of the item.
    rect: Vec<f64>,
}

/// The reference entry a link destination lands on: the entry on that page whose first line
/// starts at or just below the destination point, preferring the destination's column.
#[must_use]
pub fn reference_for_destination<'a>(
    dest: &AnalysisLinkDest,
    refs: &'a [AnalysisParsedReference],
) -> Option<&'a AnalysisParsedReference> {
    let on_page: Vec<&AnalysisParsedReference> =
        refs.iter().filter(|r| r.page == dest.page).collect();
    let Some(y) = dest.y else {
        return on_page.first().copied();
    };
    let same_column: Vec<&AnalysisParsedReference> = match dest.x {
        None => on_page.clone(),
        Some(x) => on_page
            .iter()
            .copied()
            .filter(|r| (r.x - x).abs() <= 40.0)
            .collect(),
    };
    pick_below(&same_column, y).or_else(|| pick_below(&on_page, y))
}

/// The entry with the highest first-line baseline at or below `y`, with a 2 pt tolerance.
fn pick_below<'a>(
    pool: &[&'a AnalysisParsedReference],
    y: f64,
) -> Option<&'a AnalysisParsedReference> {
    let mut best: Option<&'a AnalysisParsedReference> = None;
    for &reference in pool {
        if reference.y > y + 2.0 {
            continue;
        }
        if best.is_none_or(|b| reference.y > b.y) {
            best = Some(reference);
        }
    }
    best
}

/// `Number.isInteger`.
fn is_offset(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0
}

/// `/[\s,;[()\]]/` on one UTF-16 unit.
fn is_separator(unit: u16) -> bool {
    char::from_u32(u32::from(unit))
        .is_some_and(|c| is_js_whitespace(c) || matches!(c, ',' | ';' | '[' | '(' | ')' | ']'))
}

fn unit_at(units: &[u16], index: f64) -> Option<u16> {
    units.get(index as usize).copied()
}

/// Horizontal overlap of two `[x1, y1, x2, y2]` boxes, in points.
fn overlap_x(a: &[f64], b: &[f64]) -> f64 {
    js_math::min(a[2], b[2]) - js_math::max(a[0], b[0])
}

fn overlap_y(a: &[f64], b: &[f64]) -> f64 {
    js_math::min(a[3], b[3]) - js_math::max(a[1], b[1])
}

/// The page text (items joined, `\n` after each EOL item) and the items with a box and text.
fn page_rows(page: &LinkCitationPage) -> (Vec<Row>, Vec<u16>) {
    let mut rows = Vec::new();
    let mut units: Vec<u16> = Vec::new();
    for item in &page.items {
        let start = units.len() as f64;
        units.extend(item.str.encode_utf16());
        if item.has_eol == Some(true) {
            units.push(0x000A);
        }
        let rect = item_to_rect(item, 0.0, f64::INFINITY);
        if let Some(rect) = rect.filter(|_| !js_trim(&item.str).is_empty()) {
            rows.push(Row {
                start,
                len: utf16_len(&item.str) as f64,
                rect,
            });
        }
    }
    (rows, units)
}

/// The part of one item that a link box covers, by proportion of its width; `None` when the
/// box misses the item.
fn row_span(link: &AnalysisPdfLink, row: &Row) -> Option<(f64, f64)> {
    let rect = &row.rect;
    let h = rect[3] - rect[1];
    if overlap_y(&link.rect, rect) < js_math::min(h, link.rect[3] - link.rect[1]) * 0.4 {
        return None;
    }
    let w = rect[2] - rect[0];
    // A box grazing a neighbour by less than half a glyph is not over it.
    if overlap_x(&link.rect, rect) < js_math::min(2.0, (w / row.len) * 0.5) {
        return None;
    }
    let (from, to) = if w > 0.0 {
        (
            js_math::max(
                0.0,
                js_math::round(((link.rect[0] - rect[0]) / w) * row.len),
            ),
            js_math::min(
                row.len,
                js_math::round(((link.rect[2] - rect[0]) / w) * row.len),
            ),
        )
    } else {
        (0.0, row.len)
    };
    (to > from).then_some((row.start + from, row.start + to))
}

/// The trimmed text span one link covers: its measured ranges when it has them, else the
/// proportional estimate over the items.
fn link_span(link: &AnalysisPdfLink, rows: &[Row], units: &[u16]) -> Option<(f64, f64)> {
    let len = units.len() as f64;
    let measured: Vec<&AnalysisTextSpan> = link
        .text_ranges
        .iter()
        .flatten()
        .filter(|r| {
            is_offset(r.start)
                && is_offset(r.end)
                && r.start >= 0.0
                && r.end > r.start
                && r.end <= len
        })
        .collect();
    let pieces: Vec<(f64, f64)> = if measured.is_empty() {
        rows.iter().filter_map(|row| row_span(link, row)).collect()
    } else {
        measured.iter().map(|r| (r.start, r.end)).collect()
    };
    let mut start = pieces
        .iter()
        .fold(f64::INFINITY, |acc, &(s, _)| js_math::min(acc, s));
    let mut end = pieces
        .iter()
        .fold(-1.0, |acc, &(_, e)| js_math::max(acc, e));
    while start < end && unit_at(units, start).is_some_and(is_separator) {
        start += 1.0;
    }
    while end > start && unit_at(units, end - 1.0).is_some_and(is_separator) {
        end -= 1.0;
    }
    (end > start).then_some((start, end))
}

/// The text spans a set of link boxes cover, under the page-text convention.
#[must_use]
pub fn covered_text_spans(page: &LinkCitationPage, links: &[AnalysisPdfLink]) -> CoveredTextSpans {
    let (rows, units) = page_rows(page);
    let spans = links
        .iter()
        .filter_map(|link| {
            link_span(link, &rows, &units).map(|(start, end)| CoveredTextSpan {
                link: link.clone(),
                start,
                end,
            })
        })
        .collect();
    CoveredTextSpans {
        spans,
        text: String::from_utf16_lossy(&units),
    }
}

/// `text.slice(start, end)` on UTF-16 offsets.
fn utf16_slice(text: &str, start: f64, end: f64) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16_lossy(units.get(start as usize..end as usize).unwrap_or(&[]))
}

/// Citation mentions from a page's links: each internal link that resolves to an entry gives the
/// page text under its box. The document's own links are trusted before any text parsing.
#[must_use]
pub fn link_citation_mentions(
    page: &LinkCitationPage,
    links: &[AnalysisPdfLink],
    refs: &[AnalysisParsedReference],
) -> Vec<AnalysisCitationMention> {
    let citing: Vec<AnalysisPdfLink> = links
        .iter()
        .filter(|link| link.dest.is_some() && link.url.as_deref().unwrap_or("").is_empty())
        .cloned()
        .collect();
    if citing.is_empty() {
        return Vec::new();
    }
    let covered = covered_text_spans(page, &citing);
    let number = page.number;
    let mut out: Vec<AnalysisCitationMention> = Vec::new();
    for span in &covered.spans {
        let Some(reference) = span
            .link
            .dest
            .as_ref()
            .and_then(|dest| reference_for_destination(dest, refs))
        else {
            continue;
        };
        let (start, end) = (span.start, span.end);
        if out.iter().any(|m| start < m.end && end > m.start) {
            continue;
        }
        out.push(AnalysisCitationMention {
            id: format!("c:{number}:{start}-{end}"),
            page: number,
            start,
            end,
            text: utf16_slice(&covered.text, start, end),
            rects: Vec::new(),
            reference_indexes: vec![reference.index],
            source: "internal-pdf-link".to_string(),
            confidence: 1.0,
            target: None,
            destination_name: None,
            native_rects: None,
            span_source: None,
        });
    }
    out.sort_by(|a, b| a.start.total_cmp(&b.start));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference(index: f64, page: f64, x: f64, y: f64) -> AnalysisParsedReference {
        AnalysisParsedReference {
            index,
            page,
            x,
            y,
            ..Default::default()
        }
    }

    fn item(text: &str, x: f64, y: f64, width: f64) -> SelectionPageTextItem {
        SelectionPageTextItem {
            str: text.to_string(),
            transform: vec![1.0, 0.0, 0.0, 1.0, x, y],
            width: Some(width),
            height: Some(10.0),
            has_eol: Some(false),
            font_name: None,
        }
    }

    fn link_dest(page: f64, x: Option<f64>, y: Option<f64>) -> AnalysisLinkDest {
        AnalysisLinkDest { page, x, y }
    }

    fn link(rect: [f64; 4], dest: Option<AnalysisLinkDest>, url: Option<&str>) -> AnalysisPdfLink {
        AnalysisPdfLink {
            rect,
            url: url.map(str::to_string),
            dest,
            text_ranges: None,
            dest_name: None,
        }
    }

    /// `[16]` drawn at x 100..140, the `16` under the box `[110, 130]`.
    fn bracket_page() -> LinkCitationPage {
        LinkCitationPage {
            number: 1.0,
            items: vec![item("[16]", 100.0, 50.0, 40.0)],
        }
    }

    #[test]
    fn destination_picks_the_entry_at_or_below_its_point() {
        let refs = vec![
            reference(1.0, 3.0, 40.0, 690.0),
            reference(2.0, 3.0, 40.0, 674.0),
        ];
        let at = |y: f64| {
            reference_for_destination(&link_dest(3.0, Some(40.0), Some(y)), &refs).map(|r| r.index)
        };
        assert_eq!(at(688.0), Some(1.0));
        assert_eq!(at(672.0), Some(2.0));
        assert_eq!(
            reference_for_destination(&link_dest(4.0, None, None), &refs),
            None
        );
    }

    #[test]
    fn destination_column_wins_over_the_other_column() {
        let refs = vec![
            reference(1.0, 1.0, 40.0, 500.0),
            reference(2.0, 1.0, 320.0, 500.0),
        ];
        let at_column = link_dest(1.0, Some(320.0), Some(500.0));
        let in_column = reference_for_destination(&at_column, &refs);
        assert_eq!(in_column.map(|r| r.index), Some(2.0));
        let no_column = reference_for_destination(&link_dest(1.0, None, Some(500.0)), &refs);
        assert_eq!(no_column.map(|r| r.index), Some(1.0));
    }

    #[test]
    fn covered_span_trims_to_the_box_by_proportion() {
        let boxed = link([110.0, 50.0, 130.0, 60.0], None, None);
        let covered = covered_text_spans(&bracket_page(), &[boxed]);
        assert_eq!(covered.text, "[16]");
        assert_eq!(covered.spans.len(), 1);
        assert_eq!(covered.spans[0].start, 1.0);
        assert_eq!(covered.spans[0].end, 3.0);
    }

    #[test]
    fn measured_text_ranges_override_the_estimate() {
        let mut measured = link([0.0, 0.0, 0.0, 0.0], None, None);
        measured.text_ranges = Some(vec![
            AnalysisTextSpan {
                start: 1.0,
                end: 3.0,
            },
            AnalysisTextSpan {
                start: 2.0,
                end: 99.0,
            },
        ]);
        let covered = covered_text_spans(&bracket_page(), &[measured]);
        assert_eq!(covered.spans.len(), 1);
        assert_eq!(covered.spans[0].start, 1.0);
        assert_eq!(covered.spans[0].end, 3.0);
    }

    #[test]
    fn internal_link_gives_a_full_confidence_mention() {
        let refs = vec![reference(16.0, 1.0, 40.0, 498.0)];
        let links = [link(
            [110.0, 50.0, 130.0, 60.0],
            Some(link_dest(1.0, Some(40.0), Some(500.0))),
            None,
        )];
        let mentions = link_citation_mentions(&bracket_page(), &links, &refs);
        assert_eq!(mentions.len(), 1);
        let mention = &mentions[0];
        assert_eq!(mention.id, "c:1:1-3");
        assert_eq!(mention.text, "16");
        assert_eq!(mention.reference_indexes, vec![16.0]);
        assert_eq!(mention.source, "internal-pdf-link");
        assert_eq!(mention.confidence, 1.0);
    }

    #[test]
    fn external_links_give_no_mention() {
        let refs = vec![reference(16.0, 1.0, 40.0, 498.0)];
        let links = [link(
            [110.0, 50.0, 130.0, 60.0],
            Some(link_dest(1.0, Some(40.0), Some(500.0))),
            Some("https://example.org"),
        )];
        assert!(link_citation_mentions(&bracket_page(), &links, &refs).is_empty());
    }
}
