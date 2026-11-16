//! Metric chart sizing, ported from `apps/web/src/features/experiments/ui/plot-size.ts`.
//! Card widths step the axes down (medium drops titles, compact tightens gutters) and
//! make the plot taller so chrome never outweighs it. Pure: no I/O.

use serde::Serialize;

/// Card width below which the medium tier applies (drops axis titles).
pub const MEDIUM_PX: f64 = 560.0;
/// Card width below which the compact tier applies (tightens gutters).
pub const COMPACT_PX: f64 = 360.0;
/// Narrower cards squash plots past reading, so the zoom slider stops there.
pub const MIN_CARD_PX: f64 = 280.0;
const MIN_PLOT_PX: f64 = 180.0;

/// Axis density for a card width.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum PlotTier {
    /// Card at least `MEDIUM_PX` wide: full axis titles.
    Full,
    /// Card from `COMPACT_PX` up to `MEDIUM_PX`: titles dropped.
    Medium,
    /// Card under `COMPACT_PX`: tightened gutters.
    Compact,
}

impl PlotTier {
    /// The tier's name as the TypeScript side spells it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::Medium => "medium",
            Self::Compact => "compact",
        }
    }
}

/// uPlot axis sizing for one tier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AxisSpec {
    /// Axis label font size, in px.
    pub font: u32,
    /// Space reserved for the y axis, in px.
    pub y_size: u32,
    /// Space reserved for the x axis, in px.
    pub x_size: u32,
    /// Minimum spacing between x ticks, in px.
    pub x_space: u32,
    /// Minimum spacing between y ticks, in px.
    pub y_space: u32,
    /// Whether axis titles are drawn.
    pub titles: bool,
}

/// The tier for a card of `width` px. A width of 0 or less counts as full.
#[must_use]
pub fn plot_tier(width: f64) -> PlotTier {
    if width <= 0.0 || width >= MEDIUM_PX {
        PlotTier::Full
    } else if width >= COMPACT_PX {
        PlotTier::Medium
    } else {
        PlotTier::Compact
    }
}

/// uPlot axis sizing per tier: smaller font and gutters so narrow cards keep their plot area.
#[must_use]
pub fn axis_spec(tier: PlotTier) -> AxisSpec {
    match tier {
        PlotTier::Full => AxisSpec {
            font: 11,
            y_size: 54,
            x_size: 22,
            x_space: 60,
            y_space: 30,
            titles: true,
        },
        PlotTier::Medium => AxisSpec {
            font: 10,
            y_size: 46,
            x_size: 22,
            x_space: 50,
            y_space: 28,
            titles: false,
        },
        PlotTier::Compact => AxisSpec {
            font: 10,
            y_size: 46,
            x_size: 20,
            x_space: 44,
            y_space: 26,
            titles: false,
        },
    }
}

/// Plot height for a card of `width` px, capped at `base`. Narrow cards get a taller
/// aspect ratio. A width of 0 or less returns `base`.
#[must_use]
pub fn plot_height(width: f64, base: f64) -> f64 {
    if width <= 0.0 {
        return base;
    }
    let aspect = if width < COMPACT_PX {
        0.85
    } else if width < MEDIUM_PX {
        0.65
    } else {
        0.5
    };
    base.min(MIN_PLOT_PX.max((width * aspect).round()))
}

/// Columns that fit at [`MIN_CARD_PX`], counting the grid `gap` between cards. Never below 1.
#[must_use]
// Floored and at least 1, so never negative; `as` saturates at u32::MAX.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
pub fn fit_cols(grid_width: f64, gap: f64) -> u32 {
    let cols = ((grid_width + gap) / (MIN_CARD_PX + gap)).floor().max(1.0);
    // Saturating cast: a grid cannot hold more than u32::MAX columns.
    cols as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_boundaries() {
        assert_eq!(plot_tier(0.0), PlotTier::Full);
        assert_eq!(plot_tier(-5.0), PlotTier::Full);
        assert_eq!(plot_tier(559.0), PlotTier::Medium);
        assert_eq!(plot_tier(560.0), PlotTier::Full);
        assert_eq!(plot_tier(359.0), PlotTier::Compact);
        assert_eq!(plot_tier(360.0), PlotTier::Medium);
    }

    #[test]
    fn tier_names() {
        assert_eq!(PlotTier::Full.as_str(), "full");
        assert_eq!(PlotTier::Medium.as_str(), "medium");
        assert_eq!(PlotTier::Compact.as_str(), "compact");
    }

    #[test]
    fn axis_spec_per_tier() {
        let full = axis_spec(PlotTier::Full);
        assert_eq!((full.font, full.y_size, full.x_size), (11, 54, 22));
        assert_eq!((full.x_space, full.y_space, full.titles), (60, 30, true));
        let medium = axis_spec(PlotTier::Medium);
        assert_eq!(
            (medium.y_size, medium.x_space, medium.titles),
            (46, 50, false)
        );
        let compact = axis_spec(PlotTier::Compact);
        assert_eq!(
            (compact.x_size, compact.x_space, compact.y_space),
            (20, 44, 26)
        );
    }

    #[test]
    fn plot_height_caps_at_base_and_floors_at_min() {
        assert_eq!(plot_height(0.0, 300.0), 300.0);
        // 200 * 0.85 = 170, floored to 180.
        assert_eq!(plot_height(200.0, 300.0), 180.0);
        // 400 * 0.65 = 260, capped at base 240.
        assert_eq!(plot_height(400.0, 240.0), 240.0);
        // 800 * 0.5 = 400, capped at 300.
        assert_eq!(plot_height(800.0, 300.0), 300.0);
        // 500 * 0.65 = 325 with base 400.
        assert_eq!(plot_height(500.0, 400.0), 325.0);
    }

    #[test]
    fn fit_cols_counts_gap_and_never_drops_below_one() {
        assert_eq!(fit_cols(0.0, 12.0), 1);
        // (279 + 12) / 292 = 0.996 floors to 0, clamped to 1.
        assert_eq!(fit_cols(279.0, 12.0), 1);
        // (283 + 12) / 292 = 1.01 -> 1; (584 + 12) / 292 = 2.04 -> 2.
        assert_eq!(fit_cols(283.0, 12.0), 1);
        assert_eq!(fit_cols(584.0, 12.0), 2);
        assert_eq!(fit_cols(1200.0, 0.0), 4);
    }
}
