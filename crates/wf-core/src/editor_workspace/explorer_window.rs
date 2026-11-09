//! Which explorer rows are painted (M04). A port of `rowSlots` in
//! `apps/web/src/features/editor-workspace/application/explorer-window.ts`.
//! The row constants stay in TS and arrive as [`RowMetrics`].

use serde::{Deserialize, Serialize};

/// The panel's row geometry, passed in from the TS constants.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RowMetrics {
    /// One row's height in CSS px.
    pub row_px: f64,
    /// Rows painted before the panel has a size to measure.
    pub first_paint_rows: f64,
    /// Rows painted past each edge of the view.
    pub overscan_rows: f64,
}

/// Where one section's rows sit in the scroller, all in CSS px.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ExplorerViewport {
    /// The scroller's scroll offset.
    pub scroll_top: f64,
    /// The scroller's visible height.
    pub height: f64,
    /// The top of the section's first row inside the scrolled content.
    pub rows_top: f64,
}

/// One painted row, or a gap standing in for `rows` unpainted rows.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RowSlot {
    /// A painted row at `index`.
    Row {
        /// Position of the row in the section.
        #[cfg_attr(feature = "specta", specta(type = u32))]
        index: f64,
    },
    /// `rows` unpainted rows, sized so the scrollbar keeps its place.
    Gap {
        /// How many rows the gap stands for.
        #[cfg_attr(feature = "specta", specta(type = u32))]
        rows: f64,
    },
}

/// The section's rows as painted rows and gaps, in order.
///
/// `pinned` rows are painted wherever they are: the focused row, a rename or a
/// draft in progress would otherwise unmount as the list scrolls away from
/// them. `viewport` is `None` until the panel has been measured. Pins that are
/// not whole numbers in `0..count` are ignored.
#[must_use]
pub fn row_slots(
    count: f64,
    viewport: Option<ExplorerViewport>,
    pinned: &[f64],
    metrics: RowMetrics,
) -> Vec<RowSlot> {
    let mut start = 0.0;
    let mut end = count.min(metrics.first_paint_rows);
    if let Some(view) = viewport {
        let top = view.scroll_top - view.rows_top;
        start = ((top / metrics.row_px).floor() - metrics.overscan_rows).max(0.0);
        end = (((top + view.height) / metrics.row_px).ceil() + metrics.overscan_rows).min(count);
    }

    let mut indices: Vec<f64> = Vec::new();
    let mut i = start;
    while i < end {
        indices.push(i);
        i += 1.0;
    }
    for &pin in pinned {
        if pin.fract() == 0.0 && pin >= 0.0 && pin < count {
            indices.push(pin);
        }
    }
    indices.sort_by(f64::total_cmp);
    indices.dedup();

    let mut slots = Vec::with_capacity(indices.len() + 2);
    let mut next = 0.0;
    for index in indices {
        if index > next {
            slots.push(RowSlot::Gap { rows: index - next });
        }
        slots.push(RowSlot::Row { index });
        next = index + 1.0;
    }
    if count > next {
        slots.push(RowSlot::Gap { rows: count - next });
    }
    slots
}

#[cfg(test)]
mod tests {
    use super::*;

    const METRICS: RowMetrics = RowMetrics {
        row_px: 25.0,
        first_paint_rows: 60.0,
        overscan_rows: 12.0,
    };
    const H: f64 = 25.0;
    const OVERSCAN: f64 = 12.0;

    fn view(scroll_top: f64, height: f64, rows_top: f64) -> Option<ExplorerViewport> {
        Some(ExplorerViewport {
            scroll_top,
            height,
            rows_top,
        })
    }

    fn painted(slots: &[RowSlot]) -> Vec<f64> {
        slots
            .iter()
            .filter_map(|slot| match slot {
                RowSlot::Row { index } => Some(*index),
                RowSlot::Gap { .. } => None,
            })
            .collect()
    }

    /// Every row is either painted or stands inside a gap, exactly once.
    fn covered(slots: &[RowSlot]) -> f64 {
        slots
            .iter()
            .map(|slot| match slot {
                RowSlot::Row { .. } => 1.0,
                RowSlot::Gap { rows } => *rows,
            })
            .sum()
    }

    #[test]
    fn two_thousand_files_paint_only_the_rows_in_view_plus_overscan() {
        let slots = row_slots(2_000.0, view(0.0, 784.0, 0.0), &[], METRICS);
        let rows = painted(&slots);
        assert_eq!(rows.len() as f64, (784.0 / H).ceil() + OVERSCAN);
        assert_eq!(rows[0], 0.0);
        assert_eq!(
            slots.last(),
            Some(&RowSlot::Gap {
                rows: 2_000.0 - rows.len() as f64
            })
        );
        assert_eq!(covered(&slots), 2_000.0);
    }

    #[test]
    fn scrolled_to_the_middle_the_window_moves_with_the_scroll() {
        let scroll_top = 1_000.0 * H;
        let slots = row_slots(2_000.0, view(scroll_top, 500.0, 0.0), &[], METRICS);
        let rows = painted(&slots);
        assert_eq!(rows[0], 1_000.0 - OVERSCAN);
        assert_eq!(rows.last(), Some(&(1_000.0 + 500.0 / H + OVERSCAN - 1.0)));
        assert_eq!(
            slots[0],
            RowSlot::Gap {
                rows: 1_000.0 - OVERSCAN
            }
        );
        assert_eq!(covered(&slots), 2_000.0);
    }

    #[test]
    fn the_rows_own_offset_in_the_scroller_is_taken_into_account() {
        // Rows starting 300px down: at scrollTop 0 only (784 - 300) / 25 are on screen.
        let rows = painted(&row_slots(2_000.0, view(0.0, 784.0, 300.0), &[], METRICS));
        assert_eq!(rows.len() as f64, ((784.0 - 300.0) / H).ceil() + OVERSCAN);
    }

    #[test]
    fn a_section_entirely_out_of_view_paints_nothing_but_one_gap() {
        assert_eq!(
            row_slots(50.0, view(0.0, 400.0, 5_000.0), &[], METRICS),
            vec![RowSlot::Gap { rows: 50.0 }]
        );
        assert_eq!(
            row_slots(50.0, view(10_000.0, 400.0, 0.0), &[], METRICS),
            vec![RowSlot::Gap { rows: 50.0 }]
        );
    }

    #[test]
    fn before_the_panel_is_measured_the_first_rows_are_painted() {
        let slots = row_slots(2_000.0, None, &[], METRICS);
        let expected: Vec<f64> = (0..60).map(f64::from).collect();
        assert_eq!(painted(&slots), expected);
        assert_eq!(covered(&slots), 2_000.0);
    }

    #[test]
    fn a_short_list_paints_every_row_and_no_gap() {
        assert_eq!(
            row_slots(3.0, None, &[], METRICS),
            vec![
                RowSlot::Row { index: 0.0 },
                RowSlot::Row { index: 1.0 },
                RowSlot::Row { index: 2.0 },
            ]
        );
        assert!(row_slots(0.0, view(0.0, 500.0, 0.0), &[0.0], METRICS).is_empty());
    }

    #[test]
    fn pinned_rows_stay_painted_out_of_view_with_gaps_either_side() {
        let slots = row_slots(
            2_000.0,
            view(0.0, 250.0, 0.0),
            &[1_500.0, 1_500.0, -1.0, 9_999.0],
            METRICS,
        );
        let rows = painted(&slots);
        assert_eq!(
            rows.last(),
            Some(&1_500.0),
            "pinned once, out-of-range pins ignored"
        );
        assert_eq!(rows.len() as f64, 250.0 / H + OVERSCAN + 1.0);
        let pin = slots
            .iter()
            .position(|slot| *slot == RowSlot::Row { index: 1_500.0 })
            .expect("pinned row painted");
        assert!(matches!(slots[pin - 1], RowSlot::Gap { .. }));
        assert_eq!(slots[pin + 1], RowSlot::Gap { rows: 499.0 });
        assert_eq!(covered(&slots), 2_000.0);
    }
}
