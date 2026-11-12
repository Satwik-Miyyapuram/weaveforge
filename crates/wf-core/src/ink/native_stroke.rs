//! A native shell's flat stroke as capture samples (TS `nativeStrokeEvents`).
//!
//! The shell hands over `[x, y, pressure, t, …]` in view pixels. This converts
//! each full quadruple to CSS pixels, clamps the pressure, and drops a trailing
//! partial point. It runs once per stroke at pen-lift, never per pointer event.

/// The per-sample pressure a native stroke falls back to when it is not finite.
pub const NATIVE_PRESSURE_FALLBACK: f64 = 0.5;

/// Convert a flat native stroke to `x, y, pressure, t` quadruples in CSS pixels.
///
/// `dpr` divides the view-pixel coordinates; a non-positive or NaN `dpr` leaves
/// them unscaled. A pressure that is not finite becomes
/// [`NATIVE_PRESSURE_FALLBACK`]; otherwise it is clamped to `0..=1`. A trailing
/// partial quadruple is dropped.
#[must_use]
pub fn flat_stroke_samples(points: &[f64], dpr: f64) -> Vec<f64> {
    let scale = if dpr > 0.0 { 1.0 / dpr } else { 1.0 };
    let mut out = Vec::with_capacity(points.len() / 4 * 4);
    for quad in points.chunks_exact(4) {
        let pressure = if quad[2].is_finite() {
            quad[2].max(0.0).min(1.0)
        } else {
            NATIVE_PRESSURE_FALLBACK
        };
        out.push(quad[0] * scale);
        out.push(quad[1] * scale);
        out.push(pressure);
        out.push(quad[3]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // it: "a flat native stroke becomes pen events in CSS pixels"
    #[test]
    fn a_flat_native_stroke_is_scaled_to_css_pixels() {
        let out = flat_stroke_samples(&[200.0, 400.0, 0.5, 10.0, 220.0, 420.0, 0.7, 18.0], 2.0);
        assert_eq!(out, vec![100.0, 200.0, 0.5, 10.0, 110.0, 210.0, 0.7, 18.0]);
    }

    // it: "a trailing partial point is dropped, and a bad pressure is mid-range"
    #[test]
    fn a_trailing_partial_point_is_dropped_and_a_bad_pressure_is_mid_range() {
        let out = flat_stroke_samples(&[1.0, 2.0, f64::NAN, 3.0, 9.0, 9.0], 1.0);
        assert_eq!(out, vec![1.0, 2.0, 0.5, 3.0]);
    }

    #[test]
    fn a_bad_dpr_leaves_coordinates_unscaled() {
        assert_eq!(flat_stroke_samples(&[4.0, 6.0, 0.2, 1.0], 0.0), vec![4.0, 6.0, 0.2, 1.0]);
        assert_eq!(flat_stroke_samples(&[4.0, 6.0, 0.2, 1.0], f64::NAN), vec![4.0, 6.0, 0.2, 1.0]);
    }

    #[test]
    fn pressure_is_clamped_to_the_unit_range() {
        let out = flat_stroke_samples(&[0.0, 0.0, 1.7, 0.0, 0.0, 0.0, -0.3, 0.0], 1.0);
        assert_eq!(out[2], 1.0);
        assert_eq!(out[6], 0.0);
    }

    #[test]
    fn an_empty_or_short_stroke_gives_nothing() {
        assert!(flat_stroke_samples(&[], 2.0).is_empty());
        assert!(flat_stroke_samples(&[1.0, 2.0, 0.5], 2.0).is_empty());
    }
}
