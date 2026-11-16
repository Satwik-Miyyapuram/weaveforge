//! Timeline layout lanes, ported from `apps/web/src/features/relations/application/graph-timeline.ts`.
//!
//! Each paper's x is fixed to its publication year, so the graph reads left to
//! right as the field developed. A node without a year gets no lane and is left
//! to the forces.

/// Canvas units between one publication year and the next.
pub const YEAR_SPACING: f64 = 90.0;

/// The year the timeline is centred on: the rounded mean of the known years.
///
/// `None` unless `layout` is `"timeline"` and at least one year is known.
#[must_use]
pub fn timeline_mid_year(layout: &str, years: &[Option<f64>]) -> Option<f64> {
    if layout != "timeline" {
        return None;
    }
    let known: Vec<f64> = years.iter().flatten().copied().collect();
    if known.is_empty() {
        return None;
    }
    #[allow(clippy::cast_precision_loss)] // A node count is far below 2^52.
    let count = known.len() as f64;
    let mean = known.iter().sum::<f64>() / count;
    Some(mean.round())
}

/// The horizontal offset of a node published in `year` from the lane centre `mid`.
///
/// `None` when the node has no year.
#[must_use]
pub fn timeline_lane_offset(mid: f64, year: Option<f64>) -> Option<f64> {
    year.map(|y| (y - mid) * YEAR_SPACING)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn force_layout_has_no_lanes() {
        assert_eq!(timeline_mid_year("force", &[Some(2020.0)]), None);
    }

    #[test]
    fn timeline_without_years_has_no_lanes() {
        assert_eq!(timeline_mid_year("timeline", &[None, None]), None);
        assert_eq!(timeline_mid_year("timeline", &[]), None);
    }

    #[test]
    fn lanes_centre_on_rounded_mean_one_spacing_per_year() {
        let mid =
            timeline_mid_year("timeline", &[Some(2019.0), Some(2020.0), Some(2022.0)]).unwrap();
        // mean 2020.33 rounds to 2020
        assert_eq!(timeline_lane_offset(mid, Some(2020.0)), Some(0.0));
        assert_eq!(
            timeline_lane_offset(mid, Some(2022.0)),
            Some(2.0 * YEAR_SPACING)
        );
        assert_eq!(
            timeline_lane_offset(mid, Some(2018.0)),
            Some(-2.0 * YEAR_SPACING)
        );
    }

    #[test]
    fn fractional_year_is_placed_not_rejected() {
        let mid = timeline_mid_year("timeline", &[Some(2020.5)]).unwrap();
        assert_eq!(mid, 2021.0);
        assert_eq!(
            timeline_lane_offset(mid, Some(2020.5)),
            Some(-0.5 * YEAR_SPACING)
        );
    }

    #[test]
    fn node_without_year_is_left_to_the_forces() {
        let mid = timeline_mid_year("timeline", &[Some(2020.0)]).unwrap();
        assert_eq!(timeline_lane_offset(mid, None), None);
    }
}
