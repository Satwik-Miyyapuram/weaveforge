//! The ink zoom table. Port of `zoom.ts`.

use super::js_math::{max, min};

/// Smallest ink zoom: half size.
pub const INK_ZOOM_MIN: f64 = 0.5;
/// Largest ink zoom: four times.
pub const INK_ZOOM_MAX: f64 = 4.0;
/// One zoom-in or zoom-out step, as a factor.
pub const INK_ZOOM_STEP: f64 = 1.25;

/// `zoom` kept within the limits; anything not a positive finite number resets to 1.
#[must_use]
pub fn clamp_ink_zoom(zoom: f64) -> f64 {
    if !zoom.is_finite() || zoom <= 0.0 {
        return 1.0;
    }
    min(INK_ZOOM_MAX, max(INK_ZOOM_MIN, zoom))
}

/// One step in, stopping at the maximum.
#[must_use]
pub fn ink_zoom_in(zoom: f64) -> f64 {
    clamp_ink_zoom(zoom * INK_ZOOM_STEP)
}

/// One step out, stopping at the minimum.
#[must_use]
pub fn ink_zoom_out(zoom: f64) -> f64 {
    clamp_ink_zoom(zoom / INK_ZOOM_STEP)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_limits_are_50_to_400_percent_with_1_25_step() {
        assert_eq!(INK_ZOOM_MIN, 0.5);
        assert_eq!(INK_ZOOM_MAX, 4.0);
        assert_eq!(INK_ZOOM_STEP, 1.25);
    }

    #[test]
    fn clamp_keeps_zoom_inside_limits() {
        assert_eq!(clamp_ink_zoom(1.0), 1.0);
        assert_eq!(clamp_ink_zoom(0.5), 0.5);
        assert_eq!(clamp_ink_zoom(4.0), 4.0);
        assert_eq!(clamp_ink_zoom(0.49), 0.5);
        assert_eq!(clamp_ink_zoom(4.01), 4.0);
        assert_eq!(clamp_ink_zoom(f64::INFINITY), 1.0);
    }

    #[test]
    fn non_positive_zoom_resets_to_100_percent() {
        for bad in [f64::NAN, f64::NEG_INFINITY, 0.0, -2.0] {
            assert_eq!(clamp_ink_zoom(bad), 1.0, "{bad}");
        }
    }

    #[test]
    fn ink_zoom_in_and_out_take_one_step_and_stop_at_limits() {
        assert_eq!(ink_zoom_in(1.0), 1.25);
        assert_eq!(ink_zoom_out(1.0), 0.8);
        assert_eq!(ink_zoom_in(3.5), 4.0);
        assert_eq!(ink_zoom_in(4.0), 4.0);
        assert_eq!(ink_zoom_out(0.6), 0.5);
        assert_eq!(ink_zoom_out(0.5), 0.5);
    }

    #[test]
    fn wheel_or_pinch_factor_scales_zoom_and_is_clamped() {
        assert_eq!(clamp_ink_zoom(2.0 * 1.1), 2.0 * 1.1);
        assert_eq!(clamp_ink_zoom(3.9 * 1.5), 4.0);
        assert_eq!(clamp_ink_zoom(0.6 * 0.5), 0.5);
    }
}
