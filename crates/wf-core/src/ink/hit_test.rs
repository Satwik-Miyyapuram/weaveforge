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

#[cfg(test)]
mod tests {
    use super::*;

    const SQUARE: [f64; 8] = [0.0, 0.0, 10.0, 0.0, 10.0, 10.0, 0.0, 10.0];

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
