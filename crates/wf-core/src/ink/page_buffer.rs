//! The pure parts of the page buffer (a port of
//! `apps/web/src/features/ink/application/page-buffer.ts`): bounding boxes, the
//! compaction remap, the background-index clamp and a stroke's typed arrays.
//!
//! The buffer itself (its typed arrays, tombstone flags and the renderer hooks)
//! stays in TS: it is state the renderer owns, and it is not a value the core
//! can return.

use super::js_math::{max, min, round};
use super::pressure_byte;

/// A bounding box as `[minX, minY, maxX, maxY]`, in 0.1 mm.
pub type Bounds = [f64; 4];

/// The empty box, which is what a stroke with no points has.
pub const EMPTY_BOUNDS: Bounds = [0.0, 0.0, 0.0, 0.0];

/// The bounding box of two parallel coordinate arrays. Empty input gives [`EMPTY_BOUNDS`].
#[must_use]
pub fn bounds_of(xs: &[f32], ys: &[f32]) -> Bounds {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for (x, y) in xs.iter().zip(ys) {
        let px = f64::from(*x);
        let py = f64::from(*y);
        if px < min_x {
            min_x = px;
        }
        if px > max_x {
            max_x = px;
        }
        if py < min_y {
            min_y = py;
        }
        if py > max_y {
            max_y = py;
        }
    }
    if !min_x.is_finite() {
        return EMPTY_BOUNDS;
    }
    [min_x, min_y, max_x, max_y]
}

/// Whether two boxes overlap at all, touching included. `slack` grows both.
#[must_use]
pub fn bounds_intersect(a: Bounds, b: Bounds, slack: f64) -> bool {
    a[0] - slack <= b[2] + slack
        && a[2] + slack >= b[0] - slack
        && a[1] - slack <= b[3] + slack
        && a[3] + slack >= b[1] - slack
}

/// The smallest box covering `a` and `b`. A `None` start copies `b`.
#[must_use]
pub fn bounds_union(a: Option<Bounds>, b: Bounds) -> Bounds {
    match a {
        Some(a) => [
            min(a[0], b[0]),
            min(a[1], b[1]),
            max(a[2], b[2]),
            max(a[3], b[3]),
        ],
        None => b,
    }
}

/// Whether a point lies in a box, `slack` growing it.
#[must_use]
pub fn bounds_contain(bounds: Bounds, x: f64, y: f64, slack: f64) -> bool {
    x >= bounds[0] - slack
        && x <= bounds[2] + slack
        && y >= bounds[1] - slack
        && y <= bounds[3] + slack
}

/// The page's bounds over its strokes. `None` marks a dead stroke or one with no
/// points, which add nothing; an all-`None` page is [`EMPTY_BOUNDS`].
#[must_use]
pub fn page_bounds(strokes: &[Option<Bounds>]) -> Bounds {
    strokes
        .iter()
        .flatten()
        .fold(None, |acc, b| Some(bounds_union(acc, *b)))
        .unwrap_or(EMPTY_BOUNDS)
}

/// The old index of each kept stroke, in order: `result[new] == old`. Strokes with
/// `alive == false` are dropped and the rest renumber from zero.
#[must_use]
pub fn kept_indices(alive: &[bool]) -> Vec<usize> {
    alive
        .iter()
        .enumerate()
        .filter_map(|(old, live)| live.then_some(old))
        .collect()
}

/// The background attachment index, clamped to the byte the chunk header holds.
/// Non-finite input is 0.
#[must_use]
pub fn clamp_background_index(index: f64) -> u8 {
    if !index.is_finite() {
        return 0;
    }
    max(0.0, min(255.0, round(index))) as u8
}

/// A stroke's coordinates and pressures as the buffer stores them: `x`/`y` as `f32`
/// per point, pressure as a byte. A point without a pressure entry (`NaN` here)
/// stores 0. An odd trailing coordinate is dropped.
#[must_use]
pub fn stroke_arrays(points: &[f64], pressures: &[f64]) -> (Vec<f32>, Vec<f32>, Vec<u8>) {
    let count = points.len() / 2;
    let mut xs = Vec::with_capacity(count);
    let mut ys = Vec::with_capacity(count);
    let mut bytes = Vec::with_capacity(count);
    for i in 0..count {
        xs.push(points[i * 2] as f32);
        ys.push(points[i * 2 + 1] as f32);
        let reported = pressures.get(i).copied().unwrap_or(f64::NAN);
        bytes.push(pressure_byte(Some(reported)) as u8);
    }
    (xs, ys, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_of_nothing_is_the_empty_box() {
        assert_eq!(bounds_of(&[], &[]), EMPTY_BOUNDS);
    }

    #[test]
    fn bounds_of_covers_every_point() {
        let xs = [3.0_f32, -2.0, 7.0];
        let ys = [1.0_f32, 9.0, -4.0];
        assert_eq!(bounds_of(&xs, &ys), [-2.0, -4.0, 7.0, 9.0]);
    }

    #[test]
    fn boxes_that_touch_intersect_and_slack_grows_them() {
        let a = [0.0, 0.0, 10.0, 10.0];
        let touching = [10.0, 10.0, 20.0, 20.0];
        assert!(bounds_intersect(a, touching, 0.0));
        let apart = [12.0, 12.0, 20.0, 20.0];
        assert!(!bounds_intersect(a, apart, 0.0));
        assert!(bounds_intersect(a, apart, 2.0));
    }

    #[test]
    fn union_with_no_start_copies_the_other_box() {
        let b = [1.0, 2.0, 3.0, 4.0];
        assert_eq!(bounds_union(None, b), b);
        assert_eq!(
            bounds_union(Some([0.0, 0.0, 1.0, 1.0]), b),
            [0.0, 0.0, 3.0, 4.0]
        );
    }

    #[test]
    fn contain_includes_the_edge_and_honours_slack() {
        let b = [0.0, 0.0, 10.0, 10.0];
        assert!(bounds_contain(b, 10.0, 10.0, 0.0));
        assert!(!bounds_contain(b, 10.5, 5.0, 0.0));
        assert!(bounds_contain(b, 10.5, 5.0, 1.0));
    }

    #[test]
    fn the_page_bounds_skip_dead_and_empty_strokes() {
        assert_eq!(page_bounds(&[]), EMPTY_BOUNDS);
        let strokes = [
            None,
            Some([0.0, 0.0, 5.0, 5.0]),
            Some([-1.0, 2.0, 3.0, 8.0]),
        ];
        assert_eq!(page_bounds(&strokes), [-1.0, 0.0, 5.0, 8.0]);
    }

    #[test]
    fn compaction_keeps_live_strokes_in_order() {
        assert_eq!(kept_indices(&[true, false, true, true]), vec![0, 2, 3]);
        assert!(kept_indices(&[false, false]).is_empty());
    }

    #[test]
    fn background_index_clamps_to_a_byte() {
        assert_eq!(clamp_background_index(f64::NAN), 0);
        assert_eq!(clamp_background_index(-4.0), 0);
        assert_eq!(clamp_background_index(2.5), 3);
        assert_eq!(clamp_background_index(300.0), 255);
    }

    #[test]
    fn stroke_arrays_quantise_pressure_and_drop_an_odd_coordinate() {
        let (xs, ys, p) = stroke_arrays(&[1.0, 2.0, 3.0, 4.0, 5.0], &[f64::NAN, 300.0, 127.5]);
        assert_eq!(xs, vec![1.0, 3.0]);
        assert_eq!(ys, vec![2.0, 4.0]);
        assert_eq!(p, vec![0, 255]);
        // A missing pressure entry stores 0, as a NaN one does.
        let (_, _, short) = stroke_arrays(&[0.0, 0.0, 1.0, 1.0], &[127.5]);
        assert_eq!(short, vec![128, 0]);
    }
}
