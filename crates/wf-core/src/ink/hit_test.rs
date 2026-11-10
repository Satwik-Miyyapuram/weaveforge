//! Point and segment tests the ink worker uses for lasso selection and erasing:
//! a port of `pointInPolygon` and `distanceToSegmentSquared` in
//! `apps/web/src/features/ink/worker/ink-page-logic.ts`.

use super::js_math;

/// Whether `(px, py)` is inside the flat `x,y` polygon, by the even-odd rule.
#[must_use]
pub fn point_in_polygon(px: f64, py: f64, polygon: &[f64]) -> bool {
    let count = polygon.len() / 2;
    let mut inside = false;
    let mut j = count.wrapping_sub(1);
    for i in 0..count {
        let xi = polygon[i * 2];
        let yi = polygon[i * 2 + 1];
        let xj = polygon[j * 2];
        let yj = polygon[j * 2 + 1];
        let crosses = (yi > py) != (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi;
        if crosses {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// The squared distance from `(px, py)` to the segment `a`–`b`.
#[must_use]
pub fn distance_to_segment_squared(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let vx = bx - ax;
    let vy = by - ay;
    let length2 = vx * vx + vy * vy;
    let t = if length2 == 0.0 {
        0.0
    } else {
        js_math::max(
            0.0,
            js_math::min(1.0, ((px - ax) * vx + (py - ay) * vy) / length2),
        )
    };
    let dx = ax + vx * t - px;
    let dy = ay + vy * t - py;
    dx * dx + dy * dy
}

/// Whether a stroke passes within `radius` of the swept segment `from`→`to`.
///
/// The segment is sampled every `radius` along its length. A one-point stroke is
/// tested as a point; a longer one by each of its segments, because a packed stroke
/// keeps only the points that bend, so a straight line is two vertices a page apart.
#[must_use]
pub fn stroke_near_segment(
    xs: &[f32],
    ys: &[f32],
    from: (f64, f64),
    to: (f64, f64),
    radius: f64,
) -> bool {
    let (fx, fy) = from;
    let (tx, ty) = to;
    let steps = js_math::max(1.0, (js_math::hypot(tx - fx, ty - fy) / radius).ceil());
    if !steps.is_finite() {
        return false;
    }
    let steps = steps as usize;
    let r2 = radius * radius;
    for step in 0..=steps {
        let t = step as f64 / steps as f64;
        let px = fx + (tx - fx) * t;
        let py = fy + (ty - fy) * t;
        if xs.len() == 1 {
            let dx = f64::from(xs[0]) - px;
            let dy = f64::from(ys[0]) - py;
            if dx * dx + dy * dy <= r2 {
                return true;
            }
            continue;
        }
        for i in 0..xs.len().saturating_sub(1) {
            let d = distance_to_segment_squared(
                px,
                py,
                f64::from(xs[i]),
                f64::from(ys[i]),
                f64::from(xs[i + 1]),
                f64::from(ys[i + 1]),
            );
            if d <= r2 {
                return true;
            }
        }
    }
    false
}

/// Whether a lasso keeps a stroke: at least half its points lie inside the polygon.
///
/// A polygon under three points (six numbers) selects nothing, and so does a stroke
/// with no points.
#[must_use]
pub fn lasso_keeps(xs: &[f32], ys: &[f32], polygon: &[f64]) -> bool {
    if polygon.len() < 6 || xs.is_empty() {
        return false;
    }
    let inside = xs
        .iter()
        .zip(ys)
        .filter(|(x, y)| point_in_polygon(f64::from(**x), f64::from(**y), polygon))
        .count();
    inside * 2 >= xs.len()
}

/// The bounding box of a flat `x,y` polygon as `[min_x, min_y, max_x, max_y]`.
///
/// An empty polygon gives infinite bounds, as the TS loop it replaces did. A
/// trailing unpaired number is ignored.
#[must_use]
pub fn polygon_bounds(polygon: &[f64]) -> [f64; 4] {
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for point in polygon.chunks_exact(2) {
        bounds[0] = js_math::min(bounds[0], point[0]);
        bounds[1] = js_math::min(bounds[1], point[1]);
        bounds[2] = js_math::max(bounds[2], point[0]);
        bounds[3] = js_math::max(bounds[3], point[1]);
    }
    bounds
}

#[cfg(test)]
mod tests {
    use super::*;

    const SQUARE: [f64; 8] = [0.0, 0.0, 10.0, 0.0, 10.0, 10.0, 0.0, 10.0];

    #[test]
    fn a_swept_segment_hits_a_stroke_it_crosses() {
        let xs = [0.0_f32, 10.0];
        let ys = [5.0_f32, 5.0];
        assert!(stroke_near_segment(&xs, &ys, (5.0, 0.0), (5.0, 10.0), 1.0));
        // Stops two units short of the stroke, which is outside a radius of one.
        assert!(!stroke_near_segment(&xs, &ys, (5.0, 0.0), (5.0, 3.0), 1.0));
    }

    #[test]
    fn a_single_point_stroke_is_tested_as_a_point() {
        let xs = [5.0_f32];
        let ys = [5.0_f32];
        assert!(stroke_near_segment(&xs, &ys, (5.0, 4.0), (5.0, 4.0), 1.5));
        assert!(!stroke_near_segment(&xs, &ys, (5.0, 4.0), (5.0, 4.0), 0.5));
    }

    #[test]
    fn a_lasso_keeps_a_stroke_at_least_half_inside() {
        let inside_half = [5.0_f32, 5.0, 20.0, 20.0];
        let row = [5.0_f32, 5.0, 5.0, 5.0];
        assert!(lasso_keeps(&inside_half, &row, &SQUARE));
        let one_of_three = [5.0_f32, 20.0, 20.0];
        let row3 = [5.0_f32, 5.0, 5.0];
        assert!(!lasso_keeps(&one_of_three, &row3, &SQUARE));
    }

    #[test]
    fn a_short_lasso_or_an_empty_stroke_selects_nothing() {
        let xs = [5.0_f32];
        let ys = [5.0_f32];
        assert!(!lasso_keeps(&xs, &ys, &[0.0, 0.0, 10.0, 10.0]));
        assert!(!lasso_keeps(&[], &[], &SQUARE));
    }

    #[test]
    fn polygon_bounds_is_the_box_round_the_points() {
        assert_eq!(
            polygon_bounds(&[3.0, -1.0, -2.0, 5.0, 7.0, 0.0]),
            [-2.0, -1.0, 7.0, 5.0]
        );
    }

    #[test]
    fn an_empty_polygon_has_infinite_bounds() {
        let b = polygon_bounds(&[]);
        assert_eq!(b[0], f64::INFINITY);
        assert_eq!(b[2], f64::NEG_INFINITY);
    }

    #[test]
    fn point_in_polygon_follows_the_even_odd_rule() {
        assert!(point_in_polygon(5.0, 5.0, &SQUARE));
        assert!(!point_in_polygon(15.0, 5.0, &SQUARE));
        assert!(!point_in_polygon(5.0, -1.0, &SQUARE));
    }

    #[test]
    fn an_empty_polygon_contains_nothing() {
        assert!(!point_in_polygon(0.0, 0.0, &[]));
    }

    #[test]
    fn distance_to_a_segment_clamps_to_its_ends() {
        // Projects onto the middle of the segment.
        assert_eq!(
            distance_to_segment_squared(5.0, 3.0, 0.0, 0.0, 10.0, 0.0),
            9.0
        );
        // Past the end: the distance is to the end point.
        assert_eq!(
            distance_to_segment_squared(13.0, 4.0, 0.0, 0.0, 10.0, 0.0),
            25.0
        );
        // A degenerate segment is a point.
        assert_eq!(
            distance_to_segment_squared(3.0, 4.0, 0.0, 0.0, 0.0, 0.0),
            25.0
        );
    }
}
