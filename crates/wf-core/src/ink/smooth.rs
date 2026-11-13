//! Stroke smoothing: resampling and a binomial filter. Port of `smooth.ts`.

use super::js_math;

/// Spacing the stroke is resampled to before smoothing, in 0.1 mm.
pub const INK_SMOOTH_SPACING: f64 = 3.0;

/// Smoothing passes of the five-tap binomial kernel.
pub const INK_SMOOTH_PASSES: u32 = 2;

/// Resample `points` (`x, y` pairs) to an even spacing along the path, carrying
/// `pressures` with them by linear interpolation. The first and last samples are
/// kept exactly.
#[must_use]
pub fn resample_ink_stroke(
    points: &[f64],
    pressures: &[f64],
    spacing: f64,
) -> (Vec<f64>, Vec<f64>) {
    let count = points.len() / 2;
    if count < 2 || !(spacing > 0.0) {
        return (points.to_vec(), pressures.to_vec());
    }
    let mut out_points: Vec<f64> = vec![points[0], points[1]];
    let mut out_pressures: Vec<f64> = vec![pressures.first().copied().unwrap_or(0.0)];
    let mut carry = 0.0; // distance already covered towards the next output point
    for i in 1..count {
        let ax = points[(i - 1) * 2];
        let ay = points[(i - 1) * 2 + 1];
        let bx = points[i * 2];
        let by = points[i * 2 + 1];
        let pa = pressures.get(i - 1).copied().unwrap_or(0.0);
        let pb = pressures.get(i).copied().unwrap_or(pa);
        let length = js_math::hypot(bx - ax, by - ay);
        if length == 0.0 {
            continue;
        }
        let mut along = spacing - carry;
        while along <= length {
            let u = along / length;
            out_points.push(ax + (bx - ax) * u);
            out_points.push(ay + (by - ay) * u);
            out_pressures.push(pa + (pb - pa) * u);
            along += spacing;
        }
        carry = length - (along - spacing);
    }
    // The pen's last position is the stroke's end, whatever the spacing said;
    // drop a resampled point that landed almost on it rather than doubling up.
    let last_x = points[(count - 1) * 2];
    let last_y = points[(count - 1) * 2 + 1];
    let tail_x = out_points[out_points.len() - 2];
    let tail_y = out_points[out_points.len() - 1];
    if out_points.len() > 2 && js_math::hypot(last_x - tail_x, last_y - tail_y) < spacing / 2.0 {
        out_points.truncate(out_points.len() - 2);
        out_pressures.truncate(out_pressures.len().saturating_sub(1));
    }
    out_points.push(last_x);
    out_points.push(last_y);
    out_pressures.push(pressures.get(count - 1).copied().unwrap_or(0.0));
    (out_points, out_pressures)
}

/// The five-tap binomial kernel `[1 4 6 4 1] / 16` over the interior of `values`
/// (a flat array with `stride` numbers per sample), ends pinned. Near an end the
/// kernel is truncated and renormalised rather than reflected, so the second and
/// penultimate samples lean toward the pinned ends and the stroke keeps its
/// direction into the caps.
#[must_use]
pub fn binomial_smooth(values: &[f64], stride: usize, passes: u32) -> Vec<f64> {
    let mut current = values.to_vec();
    // A zero stride has no samples to smooth; JS would loop forever here.
    if stride == 0 {
        return current;
    }
    // Fractional on odd-length input, as in JS; out-of-range reads become NaN.
    let count = values.len() as f64 / stride as f64;
    if count < 3.0 {
        return current;
    }
    let taps = [1.0, 4.0, 6.0, 4.0, 1.0];
    for _ in 0..passes {
        let mut next = current.clone();
        let mut i: usize = 1;
        while (i as f64) < count - 1.0 {
            for c in 0..stride {
                let mut sum = 0.0;
                let mut weight = 0.0;
                for k in -2_i64..=2 {
                    let j = i as i64 + k;
                    if j < 0 || j as f64 >= count {
                        continue;
                    }
                    let w = taps[(k + 2) as usize];
                    let v = current
                        .get(j as usize * stride + c)
                        .copied()
                        .unwrap_or(f64::NAN);
                    sum += v * w;
                    weight += w;
                }
                next[i * stride + c] = sum / weight;
            }
            i += 1;
        }
        current = next;
    }
    current
}

/// Resample and smooth a finished stroke: what the pen drew, without the
/// digitiser. A stroke too short to resample (a dot, a tick) is returned as is.
/// `None` for `spacing` or `passes` takes the default, as an absent JS option does.
#[must_use]
pub fn smooth_ink_stroke(
    points: &[f64],
    pressures: &[f64],
    spacing: Option<f64>,
    passes: Option<u32>,
) -> (Vec<f64>, Vec<f64>) {
    let (resampled_points, resampled_pressures) =
        resample_ink_stroke(points, pressures, spacing.unwrap_or(INK_SMOOTH_SPACING));
    if resampled_points.len() < 6 {
        return (resampled_points, resampled_pressures);
    }
    let passes = passes.unwrap_or(INK_SMOOTH_PASSES);
    (
        binomial_smooth(&resampled_points, 2, passes),
        binomial_smooth(&resampled_pressures, 1, passes),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resampling_spaces_points_evenly_and_keeps_both_ends() {
        // Uneven samples on a straight run, 20 units long: the spacing is measured
        // along the path, so a corner would shorten a chord; a line shows the rule.
        let points = [0.0, 0.0, 3.0, 0.0, 10.0, 0.0, 20.0, 0.0];
        let (out, pressures) = resample_ink_stroke(&points, &[0.2, 0.4, 0.6, 1.0], 4.0);
        assert_eq!(&out[..2], &[0.0, 0.0]);
        assert_eq!(&out[out.len() - 2..], &[20.0, 0.0]);
        let mut i = 2;
        while i + 3 < out.len() {
            let step = js_math::hypot(out[i + 2] - out[i], out[i + 3] - out[i + 1]);
            assert!((step - 4.0).abs() < 1e-9, "step {} is {step}", i / 2);
            i += 2;
        }
        assert_eq!(pressures.len(), out.len() / 2);
        assert_eq!(pressures[0], 0.2);
        assert_eq!(pressures.last(), Some(&1.0));
        assert!(
            pressures[1] > 0.4 && pressures[1] < 0.6,
            "pressure rides along"
        );
    }

    #[test]
    fn resampling_does_not_double_the_last_point() {
        let (points, _) = resample_ink_stroke(&[0.0, 0.0, 8.0, 0.0], &[0.0, 0.0], 4.0);
        assert_eq!(points, [0.0, 0.0, 4.0, 0.0, 8.0, 0.0]);
    }

    #[test]
    fn a_dot_or_a_pair_of_samples_passes_through_untouched() {
        let (points, _) = resample_ink_stroke(&[3.0, 4.0], &[1.0], 4.0);
        assert_eq!(points, [3.0, 4.0]);
        let (points, _) = smooth_ink_stroke(&[0.0, 0.0, 1.0, 0.0], &[0.0, 0.0], None, None);
        assert_eq!(points, [0.0, 0.0, 1.0, 0.0]);
    }

    #[test]
    fn the_kernel_takes_the_jitter_out_of_a_line_and_pins_its_ends() {
        let mut jittered: Vec<f64> = Vec::new();
        for i in 0..=20 {
            jittered.push(i as f64 * 3.0);
            jittered.push(if i % 2 == 0 { 0.4 } else { -0.4 });
        }
        let out = binomial_smooth(&jittered, 2, INK_SMOOTH_PASSES);
        assert_eq!(&out[..2], &[0.0, 0.4]);
        assert_eq!(&out[out.len() - 2..], &[60.0, 0.4]);
        for i in 3..18 {
            assert!(
                out[i * 2 + 1].abs() < 0.1,
                "sample {i} still wobbles: {}",
                out[i * 2 + 1]
            );
        }
        assert_eq!(
            out[10 * 2],
            30.0,
            "the along-stroke position is unchanged on an even line"
        );
    }

    #[test]
    fn a_curve_keeps_its_shape_the_smoothed_arc_stays_on_the_circle() {
        let mut points: Vec<f64> = Vec::new();
        let mut pressures: Vec<f64> = Vec::new();
        let radius = 100.0; // a 10 mm arc
        for i in 0..=60 {
            let angle = (i as f64 / 60.0) * std::f64::consts::PI;
            points.push(radius * angle.cos());
            points.push(radius * angle.sin());
            pressures.push(0.5);
        }
        let (out, _) = smooth_ink_stroke(&points, &pressures, None, None);
        for i in (0..out.len()).step_by(2) {
            let r = js_math::hypot(out[i], out[i + 1]);
            assert!(
                (r - radius).abs() < 0.5,
                "point {} left the circle: {r}",
                i / 2
            );
        }
        assert!(
            (out.len() / 2) as f64 > (radius * std::f64::consts::PI) / INK_SMOOTH_SPACING - 2.0
        );
    }

    #[test]
    fn a_corner_rounds_by_less_than_half_a_millimetre() {
        let points = [0.0, 0.0, 30.0, 0.0, 30.0, 30.0];
        let (out, _) = smooth_ink_stroke(&points, &[0.5, 0.5, 0.5], None, None);
        let mut nearest = f64::INFINITY;
        for i in (0..out.len()).step_by(2) {
            nearest = js_math::min(nearest, js_math::hypot(out[i] - 30.0, out[i + 1]));
        }
        assert!(nearest > 0.5 && nearest < 5.0, "corner cut by {nearest}");
    }
}
