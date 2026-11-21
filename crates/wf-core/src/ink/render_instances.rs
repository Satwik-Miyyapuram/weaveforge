//! The backing-store ratio for an ink page canvas and the highlighter test.
//! Port of the pure parts of the removed `render/ink-renderer.ts`; its WebGL
//! instance packer went with that renderer.

use super::js_math;

/// The most device pixels a page canvas is given before its ratio is lowered.
pub const INK_MAX_BACKING_PIXELS: f64 = 20_000_000.0;

/// The largest single dimension a backing store is allowed.
pub const INK_MAX_BACKING_DIMENSION: f64 = 8192.0;

/// The pixel ratio a canvas of `css_width x css_height` is given: the display's,
/// unless the backing store would exceed the pixel or dimension budget, in which
/// case as much of it as fits. Never below 0.1.
#[must_use]
pub fn backing_ratio(css_width: f64, css_height: f64, device_pixel_ratio: f64) -> f64 {
    let w = js_math::max(1.0, css_width);
    let h = js_math::max(1.0, css_height);
    let by_area = (INK_MAX_BACKING_PIXELS / (w * h)).sqrt();
    let by_edge = INK_MAX_BACKING_DIMENSION / js_math::max(w, h);
    js_math::max(
        0.1,
        js_math::min(js_math::min(device_pixel_ratio, by_area), by_edge),
    )
}

/// Whether a tool is drawn translucent and deduped through the stencil.
#[must_use]
pub fn uses_highlighter_pass(tool: &str) -> bool {
    tool == "highlighter"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backing_ratio_keeps_the_display_ratio_when_it_fits() {
        assert_eq!(backing_ratio(800.0, 1131.0, 1.25), 1.25);
    }

    #[test]
    fn backing_ratio_lowers_to_the_pixel_budget() {
        let ratio = backing_ratio(4000.0, 4000.0, 2.0);
        assert!((ratio - (20_000_000.0_f64 / 16_000_000.0).sqrt()).abs() < 1e-12);
    }

    #[test]
    fn backing_ratio_has_a_floor() {
        assert_eq!(backing_ratio(1_000_000.0, 1_000_000.0, 2.0), 0.1);
    }

    #[test]
    fn highlighter_is_the_only_translucent_tool() {
        assert!(uses_highlighter_pass("highlighter"));
        assert!(!uses_highlighter_pass("pen"));
    }
}
