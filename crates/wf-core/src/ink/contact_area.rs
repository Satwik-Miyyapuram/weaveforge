//! The area a touch covers, in mm², from the CSS pixels a `PointerEvent`
//! reports. The palm rule compares it with a threshold.
//!
//! A port of `contactAreaMm2` in `apps/web/src/features/ink/application/parts-4.ts`.
//! The gate's state machine and its constants stay in TypeScript.

/// CSS pixels per millimetre: 96 px to the inch, 25.4 mm to the inch.
pub const CSS_PX_PER_MM: f64 = 96.0 / 25.4;

/// Contact area above which a touch is a hand rather than a fingertip, in mm².
pub const PALM_CONTACT_AREA_MM2: f64 = 25.0;

/// A contact's area in mm². A side that is missing, zero or `NaN` gives `0`, as
/// a device that reports no contact box does.
#[must_use]
pub fn contact_area_mm2(width: f64, height: f64) -> f64 {
    if !(width > 0.0) || !(height > 0.0) {
        return 0.0;
    }
    (width / CSS_PX_PER_MM) * (height / CSS_PX_PER_MM)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_single_css_pixel_is_a_small_fraction_of_a_mm2() {
        let area = contact_area_mm2(1.0, 1.0);
        assert!(area > 0.0);
        assert!(area < 1.0);
    }

    #[test]
    fn a_missing_side_gives_zero() {
        assert_eq!(contact_area_mm2(0.0, 16.0), 0.0);
        assert_eq!(contact_area_mm2(16.0, 0.0), 0.0);
        assert_eq!(contact_area_mm2(f64::NAN, 16.0), 0.0);
    }

    #[test]
    fn a_palm_sized_contact_is_above_the_threshold() {
        assert!(contact_area_mm2(40.0, 40.0) > 25.0);
    }

    #[test]
    fn a_fingertip_sized_contact_is_below_the_threshold() {
        assert!(contact_area_mm2(5.0, 5.0) < 25.0);
    }

    #[test]
    fn the_palm_threshold_is_25_mm2_and_the_px_scale_is_css() {
        assert_eq!(PALM_CONTACT_AREA_MM2, 25.0);
        assert_eq!(CSS_PX_PER_MM, 96.0 / 25.4);
    }
}
