//! Pure rules of the DOM selection mapping in `apps/web/src/features/reader/application/parts-1.ts`:
//! two item offsets become a text-layer selection, and the pages the two ends resolved to become
//! one page span. Reading the DOM `Selection` and resolving each end to a page stay in TS.

use serde::{Deserialize, Serialize};

/// An item index and a UTF-16 offset into that item's text (TS `ItemTextOffset`).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTextOffset {
    /// Index of the text item in the page's reading order.
    pub item_index: f64,
    /// UTF-16 offset into that item's text.
    pub offset: f64,
}

/// A text-layer selection between two item offsets (TS `TextSelectionRange`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSelection {
    /// Item where the selection starts.
    pub start_item_index: f64,
    /// Offset into the start item.
    pub start_offset: f64,
    /// Item where the selection ends.
    pub end_item_index: f64,
    /// Offset into the end item.
    pub end_offset: f64,
}

/// The first and last page a selection touches, 1-based, `start_page <= end_page`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSpan {
    /// First page touched.
    pub start_page: f64,
    /// Last page touched.
    pub end_page: f64,
}

/// JS `Number.isInteger`: finite and with no fraction.
fn is_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0
}

/// Build a text-layer selection from two item offsets. `None` when either index is not a
/// non-negative integer, either offset is negative, or the two offsets are the same point.
#[must_use]
pub fn text_selection_from_offsets(
    start: ItemTextOffset,
    end: ItemTextOffset,
) -> Option<TextSelection> {
    if !is_integer(start.item_index)
        || !is_integer(end.item_index)
        || start.item_index < 0.0
        || end.item_index < 0.0
        || start.offset < 0.0
        || end.offset < 0.0
    {
        return None;
    }
    if start.item_index == end.item_index && start.offset == end.offset {
        return None;
    }
    Some(TextSelection {
        start_item_index: start.item_index,
        start_offset: start.offset,
        end_item_index: end.item_index,
        end_offset: end.offset,
    })
}

/// Combine the pages the two ends of a selection resolved to. An end that resolved to nothing
/// takes the other end's page; if neither resolved, there is no span.
#[must_use]
pub fn page_span_of(start_page: Option<f64>, end_page: Option<f64>) -> Option<PageSpan> {
    let first = start_page.or(end_page)?;
    let last = end_page.or(start_page)?;
    Some(PageSpan {
        start_page: first.min(last),
        end_page: first.max(last),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offset(item_index: f64, offset: f64) -> ItemTextOffset {
        ItemTextOffset { item_index, offset }
    }

    #[test]
    // it: "textSelectionFromOffsets builds a range"
    fn builds_a_range_between_two_offsets() {
        assert_eq!(
            text_selection_from_offsets(offset(0.0, 1.0), offset(2.0, 4.0)),
            Some(TextSelection {
                start_item_index: 0.0,
                start_offset: 1.0,
                end_item_index: 2.0,
                end_offset: 4.0,
            })
        );
    }

    #[test]
    // it: "textSelectionFromOffsets rejects empty and invalid"
    fn rejects_empty_and_invalid_offsets() {
        assert_eq!(
            text_selection_from_offsets(offset(1.0, 3.0), offset(1.0, 3.0)),
            None
        );
        assert_eq!(
            text_selection_from_offsets(offset(-1.0, 0.0), offset(0.0, 1.0)),
            None
        );
        assert_eq!(
            text_selection_from_offsets(offset(0.0, -1.0), offset(0.0, 1.0)),
            None
        );
    }

    #[test]
    fn rejects_non_integer_and_non_finite_item_indexes() {
        assert_eq!(
            text_selection_from_offsets(offset(0.5, 0.0), offset(0.0, 1.0)),
            None
        );
        assert_eq!(
            text_selection_from_offsets(offset(f64::NAN, 0.0), offset(0.0, 1.0)),
            None
        );
        assert_eq!(
            text_selection_from_offsets(offset(f64::INFINITY, 0.0), offset(0.0, 1.0)),
            None
        );
    }

    #[test]
    fn same_item_with_different_offsets_is_a_selection() {
        assert_eq!(
            text_selection_from_offsets(offset(3.0, 0.0), offset(3.0, 2.0)),
            Some(TextSelection {
                start_item_index: 3.0,
                start_offset: 0.0,
                end_item_index: 3.0,
                end_offset: 2.0,
            })
        );
    }

    #[test]
    fn one_page_resolved_fills_both_ends() {
        assert_eq!(
            page_span_of(Some(3.0), None),
            Some(PageSpan { start_page: 3.0, end_page: 3.0 })
        );
        assert_eq!(
            page_span_of(None, Some(7.0)),
            Some(PageSpan { start_page: 7.0, end_page: 7.0 })
        );
    }

    #[test]
    fn cross_page_span_is_ordered_low_to_high() {
        assert_eq!(
            page_span_of(Some(4.0), Some(5.0)),
            Some(PageSpan { start_page: 4.0, end_page: 5.0 })
        );
        assert_eq!(
            page_span_of(Some(5.0), Some(4.0)),
            Some(PageSpan { start_page: 4.0, end_page: 5.0 })
        );
    }

    #[test]
    fn no_resolved_page_is_no_span() {
        assert_eq!(page_span_of(None, None), None);
    }
}
