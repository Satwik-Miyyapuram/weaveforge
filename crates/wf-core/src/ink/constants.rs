//! The ink tuning constants (`width`, `zoom`, `smooth`, `segment`, `decode`,
//! `figure`) gathered into one object, so a JS caller reads them in one call.

use super::{decode, figure, segment, smooth, width, zoom};

/// Every ink tuning constant, field names camelCase on the JS side.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkConstants {
    /// [`width::INK_WIDTH_UNITS_PER_MM`].
    pub ink_width_units_per_mm: f64,
    /// [`width::INK_PEN_WIDTHS`].
    pub ink_pen_widths: [f64; 4],
    /// [`width::INK_PEN_WIDTH`].
    pub ink_pen_width: f64,
    /// [`width::INK_HIGHLIGHTER_WIDTH`].
    pub ink_highlighter_width: f64,
    /// [`width::INK_HIGHLIGHTER_WIDTHS`].
    pub ink_highlighter_widths: [f64; 4],
    /// [`width::INK_HIGHLIGHTER_MIN_WIDTH`].
    pub ink_highlighter_min_width: f64,
    /// [`width::INK_MIN_WIDTH`].
    pub ink_min_width: f64,
    /// [`width::INK_MAX_WIDTH`].
    pub ink_max_width: f64,
    /// [`width::INK_VELOCITY_FULL_TAPER`].
    pub ink_velocity_full_taper: f64,
    /// [`width::INK_VELOCITY_TAPER`].
    pub ink_velocity_taper: f64,
    /// [`width::INK_PRESSURE_MIN_FACTOR`].
    pub ink_pressure_min_factor: f64,
    /// [`width::INK_PRESSURE_MAX_FACTOR`].
    pub ink_pressure_max_factor: f64,
    /// [`zoom::INK_ZOOM_MIN`].
    pub ink_zoom_min: f64,
    /// [`zoom::INK_ZOOM_MAX`].
    pub ink_zoom_max: f64,
    /// [`zoom::INK_ZOOM_STEP`].
    pub ink_zoom_step: f64,
    /// [`smooth::INK_SMOOTH_SPACING`].
    pub ink_smooth_spacing: f64,
    /// [`smooth::INK_SMOOTH_PASSES`].
    pub ink_smooth_passes: u32,
    /// [`segment::INK_GROUP_WINDOW_MS`].
    pub ink_group_window_ms: f64,
    /// [`segment::INK_LINE_BAND_RATIO`].
    pub ink_line_band_ratio: f64,
    /// [`decode::INK_ENGINE_MAX_CONFIDENCE`].
    pub ink_engine_max_confidence: f64,
    /// [`figure::FIGURE_ALT`].
    pub figure_alt: &'static str,
    /// [`figure::FIGURE_HANDLES`].
    pub figure_handles: [&'static str; 8],
}

/// The ink tuning constants as one value.
#[must_use]
pub fn ink_constants() -> InkConstants {
    InkConstants {
        ink_width_units_per_mm: width::INK_WIDTH_UNITS_PER_MM,
        ink_pen_widths: width::INK_PEN_WIDTHS,
        ink_pen_width: width::INK_PEN_WIDTH,
        ink_highlighter_width: width::INK_HIGHLIGHTER_WIDTH,
        ink_highlighter_widths: width::INK_HIGHLIGHTER_WIDTHS,
        ink_highlighter_min_width: width::INK_HIGHLIGHTER_MIN_WIDTH,
        ink_min_width: width::INK_MIN_WIDTH,
        ink_max_width: width::INK_MAX_WIDTH,
        ink_velocity_full_taper: width::INK_VELOCITY_FULL_TAPER,
        ink_velocity_taper: width::INK_VELOCITY_TAPER,
        ink_pressure_min_factor: width::INK_PRESSURE_MIN_FACTOR,
        ink_pressure_max_factor: width::INK_PRESSURE_MAX_FACTOR,
        ink_zoom_min: zoom::INK_ZOOM_MIN,
        ink_zoom_max: zoom::INK_ZOOM_MAX,
        ink_zoom_step: zoom::INK_ZOOM_STEP,
        ink_smooth_spacing: smooth::INK_SMOOTH_SPACING,
        ink_smooth_passes: smooth::INK_SMOOTH_PASSES,
        ink_group_window_ms: segment::INK_GROUP_WINDOW_MS,
        ink_line_band_ratio: segment::INK_LINE_BAND_RATIO,
        ink_engine_max_confidence: decode::INK_ENGINE_MAX_CONFIDENCE,
        figure_alt: figure::FIGURE_ALT,
        figure_handles: figure::FIGURE_HANDLES,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gathers_the_module_constants() {
        let constants = ink_constants();
        assert_eq!(
            constants.ink_pen_width.to_bits(),
            width::INK_PEN_WIDTH.to_bits()
        );
        assert_eq!(constants.figure_handles, figure::FIGURE_HANDLES);
        assert_eq!(constants.ink_smooth_passes, smooth::INK_SMOOTH_PASSES);
    }
}
