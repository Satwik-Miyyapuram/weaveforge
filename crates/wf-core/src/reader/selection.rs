//! Text-selection to anchor, and pdf.js text-item to rect. A faithful port of
//! packages/core/src/reader/selection-to-anchor.ts.
//!
//! Stays in TS: reading pdf.js text content and DOM selection ranges, which produce these inputs.

// A port of JS number code: offsets are UTF-16 code units held as f64, and
// index casts mirror JS numbers used as indices, all bounded by slice lengths.
#![allow(
    clippy::neg_cmp_op_on_partial_ord,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    clippy::cast_lossless
)]

use super::anchor::{
    AnchorCombinedPdf, AnchorPdfLocus, AnchorPositionSelector, AnchorQuoteSelector,
    AnchorZoteroPosition,
};
use crate::ink::js_math;
use crate::search::js_text::{is_js_whitespace, utf16_len};
use serde::Deserialize;

/// Context kept on each side of the quote (TS `maxChars` default in `contextBefore`/`contextAfter`).
const CONTEXT_CHARS: usize = 32;
const NEWLINE: u16 = 0x000A;

/// One pdf.js text item in PDF user space (TS `PageTextItem`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SelectionPageTextItem {
    /// Glyph run text.
    #[serde(default)]
    pub str: String,
    /// pdf.js transform `[a,b,c,d,e,f]`; `e,f` are the origin. Missing reads as empty.
    #[serde(default)]
    pub transform: Vec<f64>,
    /// Run advance width; missing is non-finite.
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub width: Option<f64>,
    /// Run height; missing or zero falls back to the transform's scale.
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub height: Option<f64>,
    /// Whether a line break follows this item.
    #[serde(default, rename = "hasEOL")]
    #[cfg_attr(feature = "specta", specta(type = bool))]
    pub has_eol: Option<bool>,
    /// pdf.js font name, unused here.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub font_name: Option<String>,
}

/// One page's text geometry (TS `PageTextGeometry`). `pageWidth`/`pageHeight` are ignored.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SelectionPageTextGeometry {
    /// Zero-based page index.
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub page_index: Option<f64>,
    /// Text items in reading order.
    #[serde(default)]
    pub items: Vec<SelectionPageTextItem>,
    /// Hash of the PDF the geometry came from.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub content_hash: Option<String>,
}

/// A text-layer selection (TS `TextSelectionRange`). Offsets are UTF-16 code units.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SelectionTextRange {
    /// Index of the item where the selection starts.
    pub start_item_index: f64,
    /// Offset into that item's text.
    pub start_offset: f64,
    /// Index of the item where the selection ends.
    pub end_item_index: f64,
    /// Offset into that item's text.
    pub end_offset: f64,
}

/// UTF-16 code units of `s`.
fn units(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// `String.prototype.trim`, which differs from Rust `str::trim`.
fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// True for a JS whitespace code unit.
fn is_space_unit(u: u16) -> bool {
    char::from_u32(u32::from(u)).is_some_and(is_js_whitespace)
}

/// Whether a JS number is an integer (`Number.isInteger`).
fn is_js_integer(x: f64) -> bool {
    x.is_finite() && x.trunc() == x
}

/// The `Number` to index for JS `slice`: NaN is 0, fractions truncate, negatives count from the end.
fn relative_index(n: f64, len: usize) -> usize {
    let n = if n.is_nan() { 0.0 } else { n.trunc() };
    let len = len as f64;
    if n < 0.0 {
        (len + n).max(0.0) as usize
    } else {
        n.min(len) as usize
    }
}

/// JS `slice(start, end)` on UTF-16 units.
fn js_slice(units: &[u16], start: f64, end: f64) -> &[u16] {
    let from = relative_index(start, units.len());
    let to = relative_index(end, units.len()).max(from);
    &units[from..to]
}

/// The truthy `Number` test of JS: not zero and not NaN.
fn is_truthy(n: f64) -> bool {
    n != 0.0 && !n.is_nan()
}

/// Convert a text-layer selection into a `CombinedPdfAnchor`. Pure; rects are
/// PDF user-space. Port of TS `selectionToAnchor`.
#[must_use]
pub fn selection_to_anchor(
    selection: &SelectionTextRange,
    page: &SelectionPageTextGeometry,
) -> Option<AnchorCombinedPdf> {
    let items = &page.items;
    let (start_item, start_offset, end_item, end_offset) =
        normalise_selection(selection, items.len())?;

    let exact = extract_exact(items, start_item, start_offset, end_item, end_offset);
    if exact.iter().all(|&u| is_space_unit(u)) {
        return None;
    }

    let prefix = context_before(items, start_item, start_offset, CONTEXT_CHARS);
    let suffix = context_after(items, end_item, end_offset, CONTEXT_CHARS);
    let char_start = absolute_offset(items, start_item, start_offset);
    let char_end = absolute_offset(items, end_item, end_offset);

    let locus = AnchorPdfLocus {
        quote: AnchorQuoteSelector {
            kind: Some("TextQuoteSelector".to_owned()),
            exact: Some(String::from_utf16_lossy(&exact)),
            prefix: (!prefix.is_empty()).then(|| String::from_utf16_lossy(&prefix)),
            suffix: (!suffix.is_empty()).then(|| String::from_utf16_lossy(&suffix)),
        },
        position: Some(AnchorPositionSelector {
            kind: Some("TextPositionSelector".to_owned()),
            start: Some(char_start),
            end: Some(char_end),
        }),
    };

    let mut rects: Vec<Vec<f64>> = Vec::new();
    for (i, item) in items.iter().enumerate().take(end_item + 1).skip(start_item) {
        if item.str.is_empty() {
            continue;
        }
        let from = if i == start_item { start_offset } else { 0.0 };
        let to = if i == end_item {
            end_offset
        } else {
            utf16_len(&item.str) as f64
        };
        if let Some(rect) = item_to_rect(item, from, to) {
            rects.push(rect);
        }
    }

    let content_hash = page
        .content_hash
        .as_deref()
        .map(js_trim)
        .filter(|hash| !hash.is_empty())
        .map(str::to_owned);

    Some(AnchorCombinedPdf {
        content_hash,
        zotero_position: Some(AnchorZoteroPosition {
            page_index: page.page_index,
            rects: (!rects.is_empty()).then_some(rects),
            ..Default::default()
        }),
        locus: Some(locus),
    })
}

/// Validate indices and order the selection. Returns `(startItem, startOffset, endItem, endOffset)`.
/// Port of TS `normaliseSelection`.
fn normalise_selection(
    selection: &SelectionTextRange,
    item_count: usize,
) -> Option<(usize, f64, usize, f64)> {
    if item_count == 0 {
        return None;
    }
    let count = item_count as f64;
    let mut start = (selection.start_item_index, selection.start_offset);
    let mut end = (selection.end_item_index, selection.end_offset);
    let (si, ei) = (start.0, end.0);
    if !is_js_integer(si)
        || !is_js_integer(ei)
        || si < 0.0
        || ei < 0.0
        || si >= count
        || ei >= count
    {
        return None;
    }
    if si > ei || (si == ei && start.1 > end.1) {
        std::mem::swap(&mut start, &mut end);
    }
    if start.0 == end.0 && start.1 == end.1 {
        return None;
    }
    Some((start.0 as usize, start.1, end.0 as usize, end.1))
}

/// The selected text, with a newline after each item that ends a line, before the last item.
/// Port of TS `extractExact`.
fn extract_exact(
    items: &[SelectionPageTextItem],
    start_item: usize,
    start_offset: f64,
    end_item: usize,
    end_offset: f64,
) -> Vec<u16> {
    let mut out = Vec::new();
    for (i, item) in items.iter().enumerate().take(end_item + 1).skip(start_item) {
        let str_units = units(&item.str);
        let len = str_units.len() as f64;
        let from = if i == start_item {
            js_math::max(0.0, start_offset)
        } else {
            0.0
        };
        let to = if i == end_item {
            js_math::min(len, end_offset)
        } else {
            len
        };
        out.extend_from_slice(js_slice(&str_units, from, to));
        if i < end_item && item.has_eol == Some(true) {
            out.push(NEWLINE);
        }
    }
    out
}

/// Up to `max_chars` units before the selection start. Port of TS `contextBefore`.
fn context_before(
    items: &[SelectionPageTextItem],
    item_index: usize,
    offset: f64,
    max_chars: usize,
) -> Vec<u16> {
    let head = units(&items[item_index].str);
    let mut out = js_slice(&head, 0.0, js_math::max(0.0, offset)).to_vec();
    let mut i = item_index;
    while i > 0 && out.len() < max_chars {
        i -= 1;
        let mut piece = units(&items[i].str);
        if items[i].has_eol == Some(true) {
            piece.push(NEWLINE);
        }
        piece.extend_from_slice(&out);
        out = piece;
    }
    out[out.len().saturating_sub(max_chars)..].to_vec()
}

/// Up to `max_chars` units after the selection end. Port of TS `contextAfter`.
fn context_after(
    items: &[SelectionPageTextItem],
    item_index: usize,
    offset: f64,
    max_chars: usize,
) -> Vec<u16> {
    let head = units(&items[item_index].str);
    let mut out = js_slice(&head, js_math::max(0.0, offset), f64::INFINITY).to_vec();
    for item in &items[item_index + 1..] {
        if out.len() >= max_chars {
            break;
        }
        out.extend(units(&item.str));
        if item.has_eol == Some(true) {
            out.push(NEWLINE);
        }
    }
    out.truncate(max_chars);
    out
}

/// Offset from the start of the page's text, counting a newline per `hasEOL` item.
/// Port of TS `absoluteOffset`.
fn absolute_offset(items: &[SelectionPageTextItem], item_index: usize, offset: f64) -> f64 {
    let mut total = 0.0;
    for item in &items[..item_index] {
        total += utf16_len(&item.str) as f64;
        if item.has_eol == Some(true) {
            total += 1.0;
        }
    }
    total + js_math::max(0.0, offset)
}

/// pdf.js text-item transform to an axis-aligned PDF user-space rect `[x1, y1, x2, y2]`
/// (origin bottom-left). `char_from`/`char_to` narrow the rect to a character sub-range,
/// interpolated across `width`; out-of-range bounds clamp, empty slices give `None`.
/// Port of TS `itemToRect`; the TS defaults are `0` and `Infinity`.
#[must_use]
pub fn item_to_rect(
    item: &SelectionPageTextItem,
    char_from: f64,
    char_to: f64,
) -> Option<Vec<f64>> {
    let t = &item.transform;
    if t.len() < 6 {
        return None;
    }
    let x = t[4];
    let y = t[5];
    let w = item.width.unwrap_or(f64::NAN);
    let h = match item.height {
        Some(h) if is_truthy(h) => h,
        _ => {
            let scale = js_math::hypot(t[2], t[3]);
            if is_truthy(scale) { scale } else { 0.0 }
        }
    };
    if ![x, y, w, h].iter().all(|n| n.is_finite()) {
        return None;
    }

    let len = utf16_len(&item.str) as f64;
    let from = js_math::max(0.0, js_math::min(len, char_from.floor()));
    let to = js_math::max(from, js_math::min(len, char_to.floor()));
    if len == 0.0 || (from == 0.0 && to == len) {
        return Some(vec![x, y, x + w, y + h]);
    }
    // Zero-width slices are not renderable geometry; the caller drops them.
    if to == from {
        return None;
    }
    let start_x = x + (w * from) / len;
    let end_x = x + (w * to) / len;
    Some(vec![start_x, y, end_x, y + h])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_item(str: &str, x: f64, y: f64, width: f64, height: f64) -> SelectionPageTextItem {
        SelectionPageTextItem {
            str: str.to_owned(),
            transform: vec![1.0, 0.0, 0.0, 1.0, x, y],
            width: Some(width),
            height: Some(height),
            has_eol: None,
            font_name: None,
        }
    }

    fn geometry() -> SelectionPageTextGeometry {
        SelectionPageTextGeometry {
            page_index: Some(2.0),
            items: vec![
                text_item("Hello ", 72.0, 700.0, 40.0, 12.0),
                text_item("world", 112.0, 700.0, 36.0, 12.0),
                SelectionPageTextItem {
                    has_eol: Some(true),
                    ..text_item("today", 72.0, 680.0, 36.0, 12.0)
                },
            ],
            content_hash: Some("hash-abc".to_owned()),
        }
    }

    fn sel(si: f64, so: f64, ei: f64, eo: f64) -> SelectionTextRange {
        SelectionTextRange {
            start_item_index: si,
            start_offset: so,
            end_item_index: ei,
            end_offset: eo,
        }
    }

    fn rects(anchor: &AnchorCombinedPdf) -> Option<&[Vec<f64>]> {
        anchor
            .zotero_position
            .as_ref()
            .and_then(|p| p.rects.as_deref())
    }

    fn exact(anchor: &AnchorCombinedPdf) -> Option<&str> {
        anchor.locus.as_ref().and_then(|l| l.quote.exact.as_deref())
    }

    #[test]
    fn selection_to_anchor_returns_null_for_empty_or_out_of_range_selection() {
        let page = geometry();
        assert_eq!(selection_to_anchor(&sel(0.0, 1.0, 0.0, 1.0), &page), None);
        assert_eq!(selection_to_anchor(&sel(9.0, 0.0, 9.0, 1.0), &page), None);
    }

    #[test]
    fn selection_to_anchor_builds_quote_rects_and_content_hash() {
        let page = geometry();
        let anchor = selection_to_anchor(&sel(0.0, 0.0, 1.0, 5.0), &page).expect("anchor");
        assert_eq!(anchor.content_hash.as_deref(), Some("hash-abc"));
        assert_eq!(exact(&anchor), Some("Hello world"));
        assert_eq!(
            anchor.zotero_position.as_ref().and_then(|p| p.page_index),
            Some(2.0)
        );
        assert_eq!(rects(&anchor).map(<[Vec<f64>]>::len), Some(2));
        assert_eq!(
            rects(&anchor).map(|r| r[0].clone()),
            Some(vec![72.0, 700.0, 112.0, 712.0])
        );
        let position = anchor.locus.as_ref().and_then(|l| l.position.clone());
        assert_eq!(position.as_ref().and_then(|p| p.start), Some(0.0));
        assert_eq!(position.as_ref().and_then(|p| p.end), Some(11.0));
    }

    #[test]
    fn selection_to_anchor_normalises_inverted_ranges() {
        let page = geometry();
        let anchor = selection_to_anchor(&sel(1.0, 5.0, 0.0, 0.0), &page).expect("anchor");
        assert_eq!(exact(&anchor), Some("Hello world"));
    }

    #[test]
    fn item_to_rect_maps_transform_to_pdf_user_space_box() {
        let item = SelectionPageTextItem {
            str: "x".to_owned(),
            transform: vec![1.0, 0.0, 0.0, 1.0, 10.0, 20.0],
            width: Some(5.0),
            height: Some(8.0),
            has_eol: None,
            font_name: None,
        };
        assert_eq!(
            item_to_rect(&item, 0.0, f64::INFINITY),
            Some(vec![10.0, 20.0, 15.0, 28.0])
        );
        let short = SelectionPageTextItem {
            transform: vec![1.0],
            width: Some(1.0),
            height: Some(1.0),
            ..item
        };
        assert_eq!(item_to_rect(&short, 0.0, f64::INFINITY), None);
    }

    #[test]
    fn item_to_rect_narrows_to_a_character_sub_range() {
        let item = text_item("abcd", 100.0, 500.0, 40.0, 10.0);
        // Whole item, explicitly and by default.
        assert_eq!(
            item_to_rect(&item, 0.0, f64::INFINITY),
            Some(vec![100.0, 500.0, 140.0, 510.0])
        );
        assert_eq!(
            item_to_rect(&item, 0.0, 4.0),
            Some(vec![100.0, 500.0, 140.0, 510.0])
        );
        // Second half only: half the advance width, same baseline.
        assert_eq!(
            item_to_rect(&item, 2.0, 4.0),
            Some(vec![120.0, 500.0, 140.0, 510.0])
        );
        assert_eq!(
            item_to_rect(&item, 1.0, 2.0),
            Some(vec![110.0, 500.0, 120.0, 510.0])
        );
    }

    #[test]
    fn item_to_rect_clamps_out_of_range_bounds_and_drops_empty_slices() {
        let item = text_item("abcd", 100.0, 500.0, 40.0, 10.0);
        assert_eq!(
            item_to_rect(&item, -5.0, 99.0),
            Some(vec![100.0, 500.0, 140.0, 510.0])
        );
        assert_eq!(item_to_rect(&item, 2.0, 2.0), None);
        // Reversed bounds collapse rather than producing a negative-width rect.
        assert_eq!(item_to_rect(&item, 3.0, 1.0), None);
    }

    #[test]
    fn selection_to_anchor_clips_the_first_and_last_rect_to_the_selected_characters() {
        // "lo world": starts 4 chars into "Hello " (width 40 over 6 chars).
        let page = geometry();
        let anchor = selection_to_anchor(&sel(0.0, 4.0, 1.0, 5.0), &page).expect("anchor");
        let rects = rects(&anchor).expect("rects");
        assert_eq!(rects.len(), 2);
        // 72 + 40 * (4/6) = 98.666..., not 72.
        assert!(
            rects[0][0] > 98.0 && rects[0][0] < 99.0,
            "left was {}",
            rects[0][0]
        );
        assert_eq!(rects[0][2], 112.0);
        // The fully covered trailing item keeps its whole rect.
        assert_eq!(rects[1], vec![112.0, 700.0, 148.0, 712.0]);
    }

    #[test]
    fn selection_to_anchor_keeps_whole_rects_for_fully_covered_middle_items() {
        let page = geometry();
        let anchor = selection_to_anchor(&sel(0.0, 0.0, 2.0, 5.0), &page).expect("anchor");
        assert_eq!(
            anchor
                .zotero_position
                .as_ref()
                .and_then(|p| p.rects.clone()),
            Some(vec![
                vec![72.0, 700.0, 112.0, 712.0],
                vec![112.0, 700.0, 148.0, 712.0],
                vec![72.0, 680.0, 108.0, 692.0],
            ])
        );
    }

    #[test]
    fn selection_to_anchor_rejects_non_integer_and_nan_indices_without_panicking() {
        let page = geometry();
        assert_eq!(
            selection_to_anchor(&sel(f64::NAN, 0.0, 1.0, 2.0), &page),
            None
        );
        assert_eq!(selection_to_anchor(&sel(0.5, 0.0, 1.0, 2.0), &page), None);
        assert_eq!(
            selection_to_anchor(
                &sel(0.0, 0.0, 1.0, 2.0),
                &SelectionPageTextGeometry {
                    items: Vec::new(),
                    ..geometry()
                }
            ),
            None
        );
    }
}
