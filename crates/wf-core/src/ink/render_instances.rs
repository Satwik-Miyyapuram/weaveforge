//! The instance data the WebGL stroke renderer draws a stroke from: each
//! Hermite span cut into `INK_SEGMENT_SUBDIVISIONS` capsules, each carrying its
//! neighbours, plus the backing-store ratio and the highlighter test. Port of
//! the pure parts of `render/ink-renderer.ts`.

use super::curve::ink_curve_at;
use super::js_math;

/// Floats per instance: `A.xy, B.xy, rA, rB, prevA.xy, nextB.xy, prevRA, nextRB`.
pub const INK_INSTANCE_FLOATS: usize = 12;

/// Instances per sample-to-sample span.
pub const INK_SEGMENT_SUBDIVISIONS: usize = 8;

/// The most device pixels a page canvas is given before its ratio is lowered.
pub const INK_MAX_BACKING_PIXELS: f64 = 20_000_000.0;

/// The largest single dimension a backing store is allowed.
pub const INK_MAX_BACKING_DIMENSION: f64 = 8192.0;

/// How many instances a stroke of `points` samples packs to.
#[must_use]
pub fn stroke_instance_count(points: usize) -> usize {
    points.saturating_sub(1) * INK_SEGMENT_SUBDIVISIONS
}

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

/// One curve point and the nib radius there.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Cap {
    x: f64,
    y: f64,
    r: f64,
}

/// The curve point between samples `i` and `i + 1` at sub-step `k`, with the
/// nib radius interpolated the way the TypeScript copy does it.
fn cap_at(xs: &[f64], ys: &[f64], radius: f64, i: usize, k: usize) -> Cap {
    let u = k as f64 / INK_SEGMENT_SUBDIVISIONS as f64;
    let (x, y) = ink_curve_at(xs, ys, i, u);
    Cap {
        x,
        y,
        r: radius * (1.0 - u) + radius * u,
    }
}

/// Pack a stroke's spans into instance data, from span `from` on.
///
/// `INK_SEGMENT_SUBDIVISIONS` instances per span, each with its neighbours: the
/// point and radius before it and after it, or a negative radius when there is
/// none. The radius is `width / 2` everywhere. Returns the floats written, so a
/// caller's buffer can be reused.
#[must_use]
pub fn pack_stroke_instances(xs: &[f64], ys: &[f64], width: f64, from: usize) -> Vec<f64> {
    let count = xs.len().min(ys.len());
    let segments = count.saturating_sub(1);
    if from >= segments {
        return Vec::new();
    }
    let last = INK_SEGMENT_SUBDIVISIONS;
    let radius = width / 2.0;
    let mut out = Vec::with_capacity((segments - from) * last * INK_INSTANCE_FLOATS);
    for i in from..segments {
        for k in 1..=last {
            let a = cap_at(xs, ys, radius, i, k - 1);
            let b = cap_at(xs, ys, radius, i, k);
            let prev = if k >= 2 {
                Some(cap_at(xs, ys, radius, i, k - 2))
            } else if i > from {
                Some(cap_at(xs, ys, radius, i - 1, last - 1))
            } else if from > 0 {
                Some(cap_at(xs, ys, radius, from - 1, last - 1))
            } else {
                None
            };
            let next = if k < last {
                Some(cap_at(xs, ys, radius, i, k + 1))
            } else if i + 1 < segments {
                Some(cap_at(xs, ys, radius, i + 1, 1))
            } else {
                None
            };
            out.extend_from_slice(&[
                a.x,
                a.y,
                b.x,
                b.y,
                a.r,
                b.r,
                prev.map_or(0.0, |p| p.x),
                prev.map_or(0.0, |p| p.y),
                next.map_or(0.0, |n| n.x),
                next.map_or(0.0, |n| n.y),
                prev.map_or(-1.0, |p| p.r),
                next.map_or(-1.0, |n| n.r),
            ]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instance_count_is_eight_per_span() {
        assert_eq!(stroke_instance_count(0), 0);
        assert_eq!(stroke_instance_count(1), 0);
        assert_eq!(stroke_instance_count(3), 16);
    }

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

    #[test]
    fn one_span_packs_eight_instances_with_no_neighbours_at_the_ends() {
        let out = pack_stroke_instances(&[0.0, 10.0], &[0.0, 0.0], 10.0, 0);
        assert_eq!(out.len(), 8 * INK_INSTANCE_FLOATS);
        // First instance: no previous neighbour, so its radius is -1.
        assert_eq!(out[10], -1.0);
        // Last instance: no next neighbour, and it ends on the second sample.
        let last = 7 * INK_INSTANCE_FLOATS;
        assert_eq!(out[last + 2], 10.0);
        assert_eq!(out[last + 11], -1.0);
        // Radii are half the width.
        assert_eq!(out[4], 5.0);
    }

    #[test]
    fn repacking_from_a_later_span_matches_the_full_pack_tail() {
        let xs = [0.0, 4.0, 9.0, 15.0];
        let ys = [0.0, 3.0, 1.0, 6.0];
        let full = pack_stroke_instances(&xs, &ys, 2.0, 0);
        let tail = pack_stroke_instances(&xs, &ys, 2.0, 1);
        assert_eq!(tail.len(), 2 * 8 * INK_INSTANCE_FLOATS);
        assert_eq!(&full[8 * INK_INSTANCE_FLOATS..], &tail[..]);
    }

    #[test]
    fn packing_past_the_last_span_writes_nothing() {
        assert!(pack_stroke_instances(&[0.0, 1.0], &[0.0, 1.0], 1.0, 5).is_empty());
    }

    #[test]
    fn length_follows_the_shorter_of_the_two_arrays() {
        // Old TS: `count = Math.min(x.length, y.length)`. The third x is ignored.
        let short = pack_stroke_instances(&[0.0, 4.0], &[0.0, 3.0], 2.0, 0);
        let long = pack_stroke_instances(&[0.0, 4.0, 9.0], &[0.0, 3.0], 2.0, 0);
        assert_eq!(long.len(), 8 * INK_INSTANCE_FLOATS);
        assert_eq!(long, short);
    }

    #[test]
    fn returned_length_is_the_full_pack_even_when_the_caller_buffer_is_short() {
        // Two spans is 16 instances. The return value is the whole pack, as the old
        // TS `cursor * INK_INSTANCE_FLOATS` was; the caller clips when it copies.
        let out = pack_stroke_instances(&[0.0, 4.0, 9.0], &[0.0, 3.0, 1.0], 2.0, 0);
        assert_eq!(out.len(), 16 * INK_INSTANCE_FLOATS);
    }
}
