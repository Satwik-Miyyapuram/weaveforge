//! The delegated ink trail's diameter. A port of the pure part of
//! `apps/web/src/features/ink/application/parts-1.ts`; the presenter and the
//! colour stay in TS.

use super::ink_page::INK_A4_WIDTH;
use super::js_math::max;
use super::render_instances::uses_highlighter_pass;

/// The trail's diameter in CSS px for a nib width in 0.1 mm on a page drawn
/// `page_width_px` wide. Never thinner than a pixel; a page with no width still
/// draws at one pixel.
#[must_use]
pub fn trail_diameter_px(width: f64, page_width_px: f64) -> f64 {
    if !(width > 0.0) || !(page_width_px > 0.0) {
        return 1.0;
    }
    max(1.0, (width / INK_A4_WIDTH) * page_width_px)
}

/// The trail's opacity for a tool: a highlighter is translucent, everything else opaque.
#[must_use]
pub fn trail_alpha(tool: &str) -> f64 {
    if uses_highlighter_pass(tool) {
        0.35
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::{trail_alpha, trail_diameter_px};
    use crate::ink::ink_page::INK_A4_WIDTH;

    #[test]
    fn only_a_highlighter_trail_is_translucent() {
        assert_eq!(trail_alpha("highlighter"), 0.35);
        assert_eq!(trail_alpha("pen"), 1.0);
    }

    #[test]
    fn a_full_page_width_nib_is_the_page_width() {
        assert_eq!(trail_diameter_px(INK_A4_WIDTH, 420.0), 420.0);
    }

    #[test]
    fn a_thin_nib_is_its_share_of_the_page() {
        assert_eq!(trail_diameter_px(10.0, 420.0), 2.0);
    }

    #[test]
    fn it_is_never_thinner_than_a_pixel() {
        assert_eq!(trail_diameter_px(0.0, 420.0), 1.0);
        assert_eq!(trail_diameter_px(f64::NAN, 420.0), 1.0);
    }

    #[test]
    fn a_page_with_no_width_still_draws() {
        assert_eq!(trail_diameter_px(10.0, 0.0), 1.0);
    }
}
