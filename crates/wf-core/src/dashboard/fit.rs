//! Fitted list-card heights. Port of `apps/web/src/features/dashboard/application/fit-card-height.ts`.
//!
//! Which cards fit their content comes in as data: `max_heights` holds only the card types
//! that fit, mapped to their largest height (the TS card registry). A card type missing from
//! it keeps its height.

use std::collections::HashMap;

use super::packing::LayoutItem;

/// The smallest a fitted list card gets, in rows: a heading plus one line.
pub const FIT_MIN_ROWS: f64 = 2.0;

/// Grid rows needed to show `px` of card, given the row height and the gap between rows.
#[must_use]
pub fn rows_for_height(px: f64, row_height: f64, margin: f64) -> f64 {
    if px <= 0.0 {
        return 0.0;
    }
    ((px + margin) / (row_height + margin)).ceil()
}

/// The layout as viewed: fitting cards take the rows they measured, kept between
/// [`FIT_MIN_ROWS`] and their largest height. A card not measured yet keeps its height.
#[must_use]
pub fn fit_layout_to_content(
    items: &[LayoutItem],
    measured: &HashMap<String, f64>,
    max_heights: &HashMap<String, f64>,
) -> Vec<LayoutItem> {
    items
        .iter()
        .map(|item| {
            let (Some(&max_h), Some(&rows)) =
                (max_heights.get(&item.card_type), measured.get(&item.id))
            else {
                return item.clone();
            };
            LayoutItem {
                h: max_h.min(FIT_MIN_ROWS.max(rows)),
                ..item.clone()
            }
        })
        .collect()
}

/// Heights for the grid positions `ids`/`heights`, with each card's saved height put back where
/// it has one, so a fitted height is never stored.
#[must_use]
pub fn stored_heights(ids: &[String], heights: &[f64], stored: &[LayoutItem]) -> Vec<f64> {
    let by_id: HashMap<&str, f64> = stored.iter().map(|it| (it.id.as_str(), it.h)).collect();
    ids.iter()
        .zip(heights)
        .map(|(id, &h)| by_id.get(id.as_str()).copied().unwrap_or(h))
        .collect()
}
