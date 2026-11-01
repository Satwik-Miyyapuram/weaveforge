//! Nib widths: pressure, speed and the clamp. Port of `width.ts`.
//!
//! Widths are in tenths of a millimetre. The reader's clamp is in PDF units and
//! would turn a 6 mm highlighter into a 2.4 mm pen, so ink notes keep their own.

use super::js_math::{hypot, max, min, round};

/// Units per millimetre. Every width and coordinate in ink notes is in these.
pub const INK_WIDTH_UNITS_PER_MM: f64 = 10.0;

/// The pen widths the ink bar offers, in 0.1 mm: 0.1, 0.3, 0.5 and 0.7 mm.
pub const INK_PEN_WIDTHS: [f64; 4] = [1.0, 3.0, 5.0, 7.0];

/// The default pen, 0.3 mm, and the width a stroke with no usable one falls back to.
pub const INK_PEN_WIDTH: f64 = 3.0;

/// Highlighter nib: 6 mm.
pub const INK_HIGHLIGHTER_WIDTH: f64 = 60.0;

/// The highlighter widths the ink bar offers, in 0.1 mm: 3, 4.5, 6 and 9 mm.
pub const INK_HIGHLIGHTER_WIDTHS: [f64; 4] = [30.0, 45.0, 60.0, 90.0];

/// At or above this width a stroke is painted as a highlighter.
pub const INK_HIGHLIGHTER_MIN_WIDTH: f64 = 25.0;

/// Tightest and widest a nib may be: 0.1 mm to 20 mm.
pub const INK_MIN_WIDTH: f64 = 1.0;
/// Widest nib: 20 mm.
pub const INK_MAX_WIDTH: f64 = 200.0;

/// Speed at which the velocity taper reaches its floor, in 0.1 mm per ms.
pub const INK_VELOCITY_FULL_TAPER: f64 = 4.0;

/// How much thinner a stroke gets at full speed: 20 % off the base width.
pub const INK_VELOCITY_TAPER: f64 = 0.2;

/// Lightest and heaviest a pressure of 0 and 1 scale the base width by.
pub const INK_PRESSURE_MIN_FACTOR: f64 = 0.7;
/// Heaviest pressure factor, at a full press.
pub const INK_PRESSURE_MAX_FACTOR: f64 = 1.3;

/// A stroke width clamped to what a nib can be. A non-finite width is missing, so it
/// takes `fallback` rather than the hairline minimum.
#[must_use]
pub fn clamp_ink_note_width(width: f64, fallback: f64) -> f64 {
    if !width.is_finite() {
        return fallback;
    }
    min(INK_MAX_WIDTH, max(INK_MIN_WIDTH, round(width)))
}

/// How pressure scales the base width, as a multiplier. `None`, non-finite, `0` and
/// `0.5` (a mouse button down) all mean "no information" and leave the width alone.
#[must_use]
pub fn ink_pressure_factor(pressure: Option<f64>) -> f64 {
    let pressure = match pressure {
        Some(p) if p.is_finite() => p,
        _ => return 1.0,
    };
    if pressure <= 0.0 || pressure == 0.5 {
        return 1.0;
    }
    let clamped = min(1.0, pressure);
    INK_PRESSURE_MIN_FACTOR + clamped * (INK_PRESSURE_MAX_FACTOR - INK_PRESSURE_MIN_FACTOR)
}

/// How speed scales the base width, as a multiplier. Linear to `full_taper`, then flat.
#[must_use]
pub fn ink_velocity_factor(velocity: f64, full_taper: f64) -> f64 {
    if !velocity.is_finite() || velocity <= 0.0 {
        return 1.0;
    }
    let fraction = min(1.0, velocity / full_taper);
    1.0 - fraction * INK_VELOCITY_TAPER
}

/// The rendered width at one point: base nib, pressure and speed together. Clamped
/// but not rounded, so the taper keeps its fractional width.
#[must_use]
pub fn nib_width(base: f64, pressure: Option<f64>, velocity: f64, full_taper: Option<f64>) -> f64 {
    let clamped_base = clamp_ink_note_width(base, INK_PEN_WIDTH);
    let width = clamped_base
        * ink_pressure_factor(pressure)
        * ink_velocity_factor(velocity, full_taper.unwrap_or(INK_VELOCITY_FULL_TAPER));
    min(INK_MAX_WIDTH, max(INK_MIN_WIDTH, width))
}

/// Velocity in 0.1 mm per ms from two samples. A zero time gap is infinitely fast.
#[must_use]
pub fn ink_velocity_between(x0: f64, y0: f64, t0: f64, x1: f64, y1: f64, t1: f64) -> f64 {
    let dt = t1 - t0;
    if !dt.is_finite() || dt <= 0.0 {
        return if dt == 0.0 { f64::INFINITY } else { 0.0 };
    }
    hypot(x1 - x0, y1 - y0) / dt
}

/// Mean nib width for a whole stroke from its samples. Keeps the stored base honest
/// when a stroke is re-rendered from geometry alone.
#[must_use]
pub fn stroke_base_width(samples: &[f64], base: f64) -> f64 {
    let usable: Vec<f64> = samples
        .iter()
        .copied()
        .filter(|p| p.is_finite() && *p > 0.0)
        .collect();
    if usable.is_empty() {
        return clamp_ink_note_width(base, INK_PEN_WIDTH);
    }
    let sum = usable.iter().fold(0.0, |sum, p| sum + p);
    let mean = sum / usable.len() as f64;
    clamp_ink_note_width(base * ink_pressure_factor(Some(mean)), INK_PEN_WIDTH)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn highlighter_survives_clamp() {
        assert_eq!(
            INK_HIGHLIGHTER_WIDTH, 60.0,
            "6 mm is 60 tenths of a millimetre"
        );
        assert_eq!(
            clamp_ink_note_width(INK_HIGHLIGHTER_WIDTH, INK_PEN_WIDTH),
            60.0
        );
        assert_eq!(
            clamp_ink_note_width(
                nib_width(INK_HIGHLIGHTER_WIDTH, Some(0.5), 0.0, None),
                INK_PEN_WIDTH
            ),
            60.0
        );
        // The reader clamps to 24 in its own units; 0.1 mm must not inherit that.
        assert_eq!(clamp_ink_note_width(24.0, INK_PEN_WIDTH), 24.0);
        assert!(clamp_ink_note_width(INK_HIGHLIGHTER_WIDTH, INK_PEN_WIDTH) > 24.0);
    }

    #[test]
    fn width_outside_nib_is_clamped_and_missing_falls_back() {
        assert_eq!(
            clamp_ink_note_width(INK_MIN_WIDTH - 1.0, INK_PEN_WIDTH),
            INK_MIN_WIDTH
        );
        assert_eq!(
            clamp_ink_note_width(INK_MAX_WIDTH + 1.0, INK_PEN_WIDTH),
            INK_MAX_WIDTH
        );
        assert_eq!(clamp_ink_note_width(f64::NAN, INK_PEN_WIDTH), INK_PEN_WIDTH);
        assert_eq!(
            clamp_ink_note_width(f64::INFINITY, INK_PEN_WIDTH),
            INK_PEN_WIDTH
        );
        // A width is a whole number of tenths of a millimetre.
        assert_eq!(clamp_ink_note_width(6.4, INK_PEN_WIDTH), 6.0);
        assert_eq!(clamp_ink_note_width(6.6, INK_PEN_WIDTH), 7.0);
    }

    #[test]
    fn highlighter_threshold_clear_of_pen_widths() {
        for width in INK_PEN_WIDTHS {
            assert!(
                width < INK_HIGHLIGHTER_MIN_WIDTH,
                "{width} is a pen, not a highlighter"
            );
        }
        const { assert!(INK_HIGHLIGHTER_WIDTH >= INK_HIGHLIGHTER_MIN_WIDTH) };
    }

    #[test]
    fn pressure_leaves_width_alone_without_report() {
        // 0 means "no pressure channel", 0.5 is what a mouse reports with a button down.
        assert_eq!(ink_pressure_factor(Some(0.0)), 1.0);
        assert_eq!(ink_pressure_factor(Some(0.5)), 1.0);
        assert_eq!(ink_pressure_factor(None), 1.0);
        assert_eq!(ink_pressure_factor(Some(f64::NAN)), 1.0);
    }

    #[test]
    fn pressure_scales_between_feather_and_full_press() {
        assert!(
            (ink_pressure_factor(Some(0.0001)) - INK_PRESSURE_MIN_FACTOR).abs() < 0.001,
            "the lightest reported pressure sits at the floor of the range"
        );
        assert_eq!(ink_pressure_factor(Some(1.0)), INK_PRESSURE_MAX_FACTOR);
        assert!(
            ink_pressure_factor(Some(0.25)) < ink_pressure_factor(Some(0.75)),
            "heavier is wider"
        );
        assert!(
            ink_pressure_factor(Some(2.0)) <= INK_PRESSURE_MAX_FACTOR,
            "pressure above 1 cannot widen further"
        );
    }

    #[test]
    fn speed_thins_to_floor_and_no_further() {
        assert_eq!(ink_velocity_factor(0.0, INK_VELOCITY_FULL_TAPER), 1.0);
        assert_eq!(ink_velocity_factor(f64::NAN, INK_VELOCITY_FULL_TAPER), 1.0);
        let half = ink_velocity_factor(2.0, 4.0);
        assert!((half - (1.0 - INK_VELOCITY_TAPER / 2.0)).abs() < 1e-9);
        assert_eq!(ink_velocity_factor(4.0, 4.0), 1.0 - INK_VELOCITY_TAPER);
        assert_eq!(
            ink_velocity_factor(400.0, 4.0),
            1.0 - INK_VELOCITY_TAPER,
            "the taper is flat above the knee"
        );
    }

    #[test]
    fn rendered_width_combines_both_and_stays_a_nib() {
        let base = INK_PEN_WIDTH;
        assert_eq!(
            nib_width(base, Some(0.5), 0.0, None),
            base,
            "a mouse draws at the base width"
        );
        assert!(
            nib_width(base, Some(1.0), 0.0, None) > base,
            "a press widens"
        );
        assert!(
            nib_width(base, Some(0.0001), 0.0, None) < base,
            "a feather touch narrows"
        );
        assert!(
            nib_width(base, Some(1.0), 10.0, None) < nib_width(base, Some(1.0), 0.0, None),
            "speed thins what pressure widened"
        );
        assert!(
            nib_width(1000.0, Some(1.0), 0.0, None) <= INK_MAX_WIDTH,
            "no combination exceeds the widest nib"
        );
        assert!(
            nib_width(0.0, Some(0.0001), 0.0, None) >= INK_MIN_WIDTH,
            "nor goes below the thinnest"
        );
    }

    #[test]
    fn velocity_from_two_samples() {
        // 30 units (3 mm) in 10 ms (100 Hz) is 3 units/ms.
        assert_eq!(ink_velocity_between(0.0, 0.0, 0.0, 30.0, 40.0, 10.0), 5.0);
        assert_eq!(
            ink_velocity_between(10.0, 10.0, 100.0, 10.0, 10.0, 140.0),
            0.0,
            "a held pen is not moving"
        );
        assert_eq!(
            ink_velocity_between(0.0, 0.0, 100.0, 1.0, 0.0, 100.0),
            f64::INFINITY,
            "the same timestamp twice is a duplicated sample, treated as infinitely fast"
        );
        assert_eq!(
            ink_velocity_between(0.0, 0.0, 100.0, 5.0, 0.0, 90.0),
            0.0,
            "time cannot run backwards"
        );
    }

    #[test]
    fn stroke_stored_width_from_mean_pressure() {
        assert_eq!(
            stroke_base_width(&[], INK_PEN_WIDTH),
            INK_PEN_WIDTH,
            "no samples means no scaling"
        );
        assert_eq!(
            stroke_base_width(&[0.0, 0.0, 0.0], INK_PEN_WIDTH),
            INK_PEN_WIDTH,
            "unreported pressure scales nothing"
        );
        assert_eq!(
            stroke_base_width(&[0.5, 0.5], INK_PEN_WIDTH),
            INK_PEN_WIDTH,
            "a mouse reports 0.5 throughout"
        );
        assert!(
            stroke_base_width(&[1.0, 1.0], INK_PEN_WIDTH) > INK_PEN_WIDTH,
            "a press stores a wider base"
        );
        // A highlighter is a marker, not a nib: stored with no pressure, exactly 6 mm.
        assert_eq!(
            stroke_base_width(&[], INK_HIGHLIGHTER_WIDTH),
            INK_HIGHLIGHTER_WIDTH
        );
        assert_eq!(
            nib_width(INK_HIGHLIGHTER_WIDTH, None, 0.0, None),
            INK_HIGHLIGHTER_WIDTH
        );
    }

    #[test]
    fn every_highlighter_size_reads_as_highlighter() {
        for width in INK_HIGHLIGHTER_WIDTHS {
            assert!(
                width >= INK_HIGHLIGHTER_MIN_WIDTH,
                "{width} is a highlighter"
            );
            assert!(width <= INK_MAX_WIDTH, "{width} is drawable");
        }
        assert!(INK_HIGHLIGHTER_WIDTHS.contains(&INK_HIGHLIGHTER_WIDTH));
    }
}
