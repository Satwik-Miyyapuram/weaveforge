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

// No TS test on main for this file; cases come from the doc comments.
#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    fn item(id: &str, card_type: &str, h: f64) -> LayoutItem {
        LayoutItem {
            id: id.to_owned(),
            card_type: card_type.to_owned(),
            x: 0.0,
            y: 0.0,
            w: 4.0,
            h,
            config: None,
            extra: serde_json::Map::new(),
        }
    }

    fn one(key: &str, value: f64) -> HashMap<String, f64> {
        HashMap::from([(key.to_owned(), value)])
    }

    #[test]
    fn rows_round_up_including_the_gap() {
        assert_eq!(rows_for_height(10.0, 10.0, 2.0), 1.0);
        assert_eq!(rows_for_height(11.0, 10.0, 2.0), 2.0);
    }

    #[test]
    fn no_height_needs_no_rows() {
        assert_eq!(rows_for_height(0.0, 10.0, 2.0), 0.0);
        assert_eq!(rows_for_height(-5.0, 10.0, 2.0), 0.0);
    }

    #[test]
    fn fitted_height_is_measured_rows_kept_between_min_and_max() {
        let items = [item("a", "notes", 8.0)];
        let max = one("notes", 6.0);
        let fit = |rows: f64| {
            fit_layout_to_content(&items, &one("a", rows), &max)
                .first()
                .map(|i| i.h)
        };
        assert_eq!(fit(1.0), Some(2.0));
        assert_eq!(fit(5.0), Some(5.0));
        assert_eq!(fit(9.0), Some(6.0));
    }

    #[test]
    fn unmeasured_card_keeps_its_height() {
        let items = [item("a", "notes", 8.0)];
        let fitted = fit_layout_to_content(&items, &HashMap::new(), &one("notes", 6.0));
        assert_eq!(fitted.first().map(|i| i.h), Some(8.0));
    }

    #[test]
    fn card_type_without_a_max_keeps_its_height() {
        let items = [item("a", "notes", 8.0)];
        let fitted = fit_layout_to_content(&items, &one("a", 3.0), &HashMap::new());
        assert_eq!(fitted.first().map(|i| i.h), Some(8.0));
    }

    #[test]
    fn stored_height_wins_over_the_given_height() {
        let ids = ["a".to_owned(), "b".to_owned()];
        let stored = [item("a", "notes", 7.0)];
        assert_eq!(stored_heights(&ids, &[3.0, 4.0], &stored), [7.0, 4.0]);
    }
}
