//! The curve a stroke is drawn as: a cubic Hermite span between each pair of
//! stored samples. The renderer draws it and the packer checks against it, so
//! what is kept at pack time is exactly what is drawn. Port of `curve.ts`.

use super::js_math::hypot;

/// Which Hermite span a tangent is for: the one ending at the sample or the
/// one starting there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    /// The span ending at the sample.
    In,
    /// The span starting at the sample.
    Out,
}

/// The tangent of the stroke at sample `i`, for the span on `side`.
///
/// The direction is the sum of the two chords (Catmull-Rom's); the magnitude
/// is the length of the span the tangent is for. At either end it is the one
/// chord there. `i` must be a sample index.
#[must_use]
pub fn ink_tangent_at(xs: &[f64], ys: &[f64], i: usize, side: Side) -> (f64, f64) {
    let count = xs.len().min(ys.len());
    let (x, y) = (xs[i], ys[i]);
    let has_prev = i > 0;
    let has_next = i + 1 < count;
    let (px, py) = if has_prev {
        (x - xs[i - 1], y - ys[i - 1])
    } else {
        (0.0, 0.0)
    };
    let (nx, ny) = if has_next {
        (xs[i + 1] - x, ys[i + 1] - y)
    } else {
        (0.0, 0.0)
    };
    let pl = hypot(px, py);
    let nl = hypot(nx, ny);
    // `!(l > 0)` on purpose: NaN counts as zero length, as in the TS copy.
    if !(pl > 0.0) && !(nl > 0.0) {
        return (0.0, 0.0);
    }
    if !(pl > 0.0) {
        return (nx, ny);
    }
    if !(nl > 0.0) {
        return (px, py);
    }
    let sx = px + nx;
    let sy = py + ny;
    let sl = hypot(sx, sy);
    if !(sl > 0.0) {
        return (0.0, 0.0);
    }
    let magnitude = match side {
        Side::Out => nl,
        Side::In => pl,
    };
    ((sx / sl) * magnitude, (sy / sl) * magnitude)
}

/// A point on the span between samples `i` and `i + 1`, at `u` in [0, 1].
/// Both must be sample indices.
#[must_use]
pub fn ink_curve_at(xs: &[f64], ys: &[f64], i: usize, u: f64) -> (f64, f64) {
    let m1 = ink_tangent_at(xs, ys, i, Side::Out);
    let m2 = ink_tangent_at(xs, ys, i + 1, Side::In);
    let uu = u * u;
    let uuu = uu * u;
    let h00 = 2.0 * uuu - 3.0 * uu + 1.0;
    let h10 = uuu - 2.0 * uu + u;
    let h01 = -2.0 * uuu + 3.0 * uu;
    let h11 = uuu - uu;
    (
        h00 * xs[i] + h10 * m1.0 + h01 * xs[i + 1] + h11 * m2.0,
        h00 * ys[i] + h10 * m1.1 + h01 * ys[i + 1] + h11 * m2.1,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn end_tangents_are_the_end_chords() {
        let xs = [0.0, 10.0, 10.0];
        let ys = [0.0, 0.0, 5.0];
        assert_eq!(ink_tangent_at(&xs, &ys, 0, Side::Out), (10.0, 0.0));
        assert_eq!(ink_tangent_at(&xs, &ys, 2, Side::In), (0.0, 5.0));
    }

    #[test]
    fn inner_tangent_takes_the_span_length() {
        let xs = [0.0, 10.0, 10.0];
        let ys = [0.0, 0.0, 5.0];
        let (ox, oy) = ink_tangent_at(&xs, &ys, 1, Side::Out);
        let (ix, iy) = ink_tangent_at(&xs, &ys, 1, Side::In);
        assert!((hypot(ox, oy) - 5.0).abs() < 1e-12);
        assert!((hypot(ix, iy) - 10.0).abs() < 1e-12);
    }

    #[test]
    fn repeated_points_have_no_tangent() {
        assert_eq!(
            ink_tangent_at(&[1.0, 1.0], &[2.0, 2.0], 0, Side::Out),
            (0.0, 0.0)
        );
        assert_eq!(ink_tangent_at(&[1.0], &[2.0], 0, Side::In), (0.0, 0.0));
    }

    #[test]
    fn a_span_passes_through_its_samples() {
        let xs = [0.0, 10.0, 20.0, 25.0];
        let ys = [0.0, 4.0, 0.0, 9.0];
        for i in 0..3 {
            assert_eq!(ink_curve_at(&xs, &ys, i, 0.0), (xs[i], ys[i]));
            let (x, y) = ink_curve_at(&xs, &ys, i, 1.0);
            assert!((x - xs[i + 1]).abs() < 1e-12 && (y - ys[i + 1]).abs() < 1e-12);
        }
    }

    #[test]
    fn a_straight_line_stays_straight() {
        let xs = [0.0, 5.0, 20.0];
        let ys = [0.0, 0.0, 0.0];
        for k in 0..=8 {
            let (_, y) = ink_curve_at(&xs, &ys, 0, f64::from(k) / 8.0);
            assert_eq!(y, 0.0);
        }
    }
}
