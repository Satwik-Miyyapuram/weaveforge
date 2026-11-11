//! Ink geometry: capture filtering, simplification, and stroke width. A faithful port of packages/core/src/reader/parts.ts.
//!
//! Stays in TS: none of this module's functions touch the DOM or async code; the TS-only
//! `InkGroupCandidate` interface is mirrored by `ReaderInkGroupCandidate` and the options
//! object of `compactInkPath` by `ReaderCompactInkOptions`.

// A port of JS number code: `!(x > 0.0)` keeps the TS NaN handling, and index
// casts mirror JS numbers used as indices, all bounded by slice lengths.
#![allow(
    clippy::neg_cmp_op_on_partial_ord,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    clippy::cast_lossless
)]

use serde::Deserialize;

use crate::ink::js_math::{hypot, max, min, round};
use crate::ink::width::{INK_PEN_WIDTHS, INK_WIDTH_UNITS_PER_MM};
use crate::sync::frontmatter::js_number;

/// Minimum gap between consecutive captured points, in PDF units.
pub const INK_MIN_POINT_DISTANCE: f64 = 0.75;
/// Ramer–Douglas–Peucker tolerance in PDF units.
pub const INK_SIMPLIFY_TOLERANCE: f64 = 0.35;
/// Coordinate decimals kept.
pub const INK_COORD_DECIMALS: f64 = 2.0;
/// Hardest cap on one stroke, in points.
pub const INK_MAX_POINTS: f64 = 400.0;
/// How many strokes one annotation row may hold.
pub const INK_MAX_PATHS_PER_ANNOTATION: f64 = 64.0;
/// Idle gap after which a stroke is treated as starting a new annotation, in ms.
pub const INK_GROUP_WINDOW_MS: f64 = 2_000.0;
/// Default stroke width in PDF units.
pub const INK_DEFAULT_WIDTH: f64 = 2.0;
/// Floor of the width clamp.
const INK_MIN_WIDTH: f64 = 0.25;
/// Ceiling of the width clamp.
const INK_MAX_WIDTH: f64 = 24.0;
/// Points per millimetre.
const PT_PER_MM: f64 = 72.0 / 25.4;
/// Nib width of the highlighter tool, in PDF units.
pub const HIGHLIGHTER_WIDTH: f64 = 14.0;
/// At or above this width an ink stroke is painted as a highlighter.
pub const HIGHLIGHTER_MIN_WIDTH: f64 = 8.0;

/// Stroke input of `compactInkPath`'s `options` object. Each field may be absent.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase", default)]
pub struct ReaderCompactInkOptions {
    /// Simplification tolerance; `None` uses the default.
    pub tolerance: Option<f64>,
    /// Maximum point count; `None` uses `INK_MAX_POINTS`.
    pub max_points: Option<f64>,
    /// Coordinate decimals; `None` uses the default.
    pub decimals: Option<f64>,
}

/// The ink group a new stroke may join, mirrors TS `InkGroupCandidate`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReaderInkGroupCandidate {
    /// Page the group sits on.
    pub page_index: f64,
    /// Colour of the group's strokes.
    pub color: String,
    /// Nib width of the group's strokes.
    pub width: f64,
    /// Strokes the target annotation already holds.
    pub path_count: f64,
    /// When the group last took a stroke.
    pub last_at: f64,
}

/// The stroke being tested against a group, mirrors the TS `canJoinInkGroup` `next` argument.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReaderInkGroupNext {
    /// Page the stroke was drawn on.
    pub page_index: f64,
    /// Colour of the stroke.
    pub color: String,
    /// Nib width of the stroke.
    pub width: f64,
    /// When the stroke was drawn.
    pub at: f64,
}

/// TS `inkNoteWidthToPdfPoints`: one ink-note nib (0.1 mm) as PDF points, rounded to 2 decimals.
#[must_use]
pub fn ink_note_width_to_pdf_points(tenths: f64) -> f64 {
    if !tenths.is_finite() {
        return INK_DEFAULT_WIDTH;
    }
    round((tenths / INK_WIDTH_UNITS_PER_MM) * PT_PER_MM * 100.0) / 100.0
}

/// TS `INK_NIB_WIDTHS_PT`: the ink note's four nibs in PDF points.
#[must_use]
pub fn ink_nib_widths_pt() -> [f64; 4] {
    INK_PEN_WIDTHS.map(ink_note_width_to_pdf_points)
}

/// TS `INK_NIB_DEFAULT_PT`: the rail's default nib, the third of `ink_nib_widths_pt`.
#[must_use]
pub fn ink_nib_default_pt() -> f64 {
    ink_nib_widths_pt()[2]
}

/// TS `isHighlighterInk`: a stored width at or above `HIGHLIGHTER_MIN_WIDTH`.
#[must_use]
pub fn is_highlighter_ink(width: Option<f64>) -> bool {
    width.is_some_and(|w| w >= HIGHLIGHTER_MIN_WIDTH)
}

/// TS `clampInkWidth`: non-finite becomes `INK_DEFAULT_WIDTH`, otherwise clamped to the nib range.
#[must_use]
pub fn clamp_ink_width(width: f64) -> f64 {
    if !width.is_finite() {
        return INK_DEFAULT_WIDTH;
    }
    min(INK_MAX_WIDTH, max(INK_MIN_WIDTH, width))
}

/// TS `inkWidthForPressure`: width for a pointer's pressure; `None`, `<= 0` and `0.5` keep `base`.
#[must_use]
pub fn ink_width_for_pressure(pressure: Option<f64>, base: f64) -> f64 {
    match pressure {
        // 0.5 is the mouse-button default, so it carries no pressure information.
        Some(p) if p.is_finite() && p > 0.0 && p != 0.5 => {
            let factor = 0.5 + min(max(p, 0.0), 1.0) * 1.5;
            clamp_ink_width(base * factor)
        }
        _ => clamp_ink_width(base),
    }
}

/// TS `meanPressure`: mean of the usable (finite, positive) samples, or `None` when there are none.
#[must_use]
pub fn mean_pressure(samples: &[f64]) -> Option<f64> {
    let usable: Vec<f64> = samples
        .iter()
        .copied()
        .filter(|p| p.is_finite() && *p > 0.0)
        .collect();
    if usable.is_empty() {
        return None;
    }
    let sum = usable.iter().fold(0.0, |sum, p| sum + p);
    Some(sum / usable.len() as f64)
}

/// TS `shouldAppendInkPoint`: whether `(x, y)` is at least `min_distance` from the last point. The first point always is.
#[must_use]
pub fn should_append_ink_point(path: &[f64], x: f64, y: f64, min_distance: f64) -> bool {
    match path {
        [.., last_x, last_y] => hypot(x - *last_x, y - *last_y) >= min_distance,
        _ => true,
    }
}

/// Distance from `(px, py)` to the segment `(ax, ay)`-`(bx, by)`, clamped to its ends.
fn perpendicular_distance(px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let dx = bx - ax;
    let dy = by - ay;
    if dx == 0.0 && dy == 0.0 {
        return hypot(px - ax, py - ay);
    }
    let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    let clamped = min(1.0, max(0.0, t));
    hypot(px - (ax + clamped * dx), py - (ay + clamped * dy))
}

/// TS `simplifyPathIndices`: indices of the points Ramer–Douglas–Peucker keeps, in order.
#[must_use]
pub fn simplify_path_indices(path: &[f64], tolerance: f64) -> Vec<usize> {
    let points: Vec<(f64, f64)> = path
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&[x, y]| (x, y))
        .collect();
    let count = points.len();
    if count == 0 {
        return Vec::new();
    }
    if count <= 2 || tolerance <= 0.0 {
        return (0..count).collect();
    }

    let mut keep = vec![false; count];
    keep[0] = true;
    keep[count - 1] = true;
    let mut stack = vec![(0_usize, count - 1)];

    while let Some((first, last)) = stack.pop() {
        if last <= first + 1 {
            continue;
        }
        let (ax, ay) = points[first];
        let (bx, by) = points[last];
        let mut worst = -1.0;
        let mut worst_index: Option<usize> = None;
        for (i, &(px, py)) in points.iter().enumerate().take(last).skip(first + 1) {
            let d = perpendicular_distance(px, py, ax, ay, bx, by);
            if d > worst {
                worst = d;
                worst_index = Some(i);
            }
        }
        if let Some(index) = worst_index
            && worst > tolerance
            && index > 0
        {
            keep[index] = true;
            stack.push((first, index));
            stack.push((index, last));
        }
    }

    (0..count).filter(|&i| keep[i]).collect()
}

/// TS `simplifyInkPath`: the flat `[x, y, …]` points kept by `simplify_path_indices`.
#[must_use]
pub fn simplify_ink_path(path: &[f64], tolerance: f64) -> Vec<f64> {
    let mut out = Vec::new();
    for index in simplify_path_indices(path, tolerance) {
        out.push(path[index * 2]);
        out.push(path[index * 2 + 1]);
    }
    out
}

/// TS `quantizeInkPath`: round every coordinate to `decimals`; any non-finite value voids the path.
#[must_use]
pub fn quantize_ink_path(path: &[f64], decimals: f64) -> Vec<f64> {
    let factor = 10_f64.powf(decimals);
    let mut out = Vec::with_capacity(path.len());
    for &value in path {
        if !value.is_finite() {
            return Vec::new();
        }
        out.push(round(value * factor) / factor);
    }
    out
}

/// TS `compactInkPath`: simplified, rounded and capped under `max_points`. `[]` when not a stroke.
#[must_use]
pub fn compact_ink_path(path: &[f64], options: &ReaderCompactInkOptions) -> Vec<f64> {
    let max_points = options.max_points.unwrap_or(INK_MAX_POINTS);
    let decimals = options.decimals.unwrap_or(INK_COORD_DECIMALS);
    let mut tolerance = options.tolerance.unwrap_or(INK_SIMPLIFY_TOLERANCE);

    let even = &path[..path.len() / 2 * 2];
    if even.len() < 4 || even.iter().any(|n| !n.is_finite()) {
        return Vec::new();
    }

    let mut simplified = quantize_ink_path(&simplify_ink_path(even, tolerance), decimals);
    // Doubling the tolerance roughly halves the surviving points, so this ends
    // after a handful of rounds even for a pathological scribble.
    let mut guard = 0;
    while simplified.len() as f64 / 2.0 > max_points && guard < 12 {
        tolerance *= 2.0;
        simplified = quantize_ink_path(&simplify_ink_path(even, tolerance), decimals);
        guard += 1;
    }
    if simplified.len() as f64 / 2.0 > max_points {
        // Still over budget: keep an evenly spaced subset so the stroke keeps its full extent.
        let count = simplified.len() / 2;
        let step = count as f64 / max_points;
        let mut out = Vec::new();
        let mut i = 0.0;
        while i < max_points {
            let index = min(count as f64 - 1.0, (i * step).floor()) as usize;
            out.push(simplified[index * 2]);
            out.push(simplified[index * 2 + 1]);
            i += 1.0;
        }
        // The true end point matters more than an evenly spaced one. An empty
        // result (non-positive cap) stays empty, as the TS property writes do.
        let n = out.len();
        if n >= 2 {
            out[n - 2] = simplified[(count - 1) * 2];
            out[n - 1] = simplified[(count - 1) * 2 + 1];
        }
        return out;
    }
    if simplified.len() >= 4 {
        simplified
    } else {
        Vec::new()
    }
}

/// TS `inkPathJsonSize`: length in characters of `JSON.stringify(path)`.
#[must_use]
pub fn ink_path_json_size(path: &[f64]) -> usize {
    let mut size = 2;
    for (i, &n) in path.iter().enumerate() {
        if i > 0 {
            size += 1;
        }
        size += if n.is_finite() { js_number(n).len() } else { 4 };
    }
    size
}

/// TS `canJoinInkGroup`: whether a stroke belongs to the annotation the group is building.
#[must_use]
pub fn can_join_ink_group(
    group: Option<&ReaderInkGroupCandidate>,
    next: &ReaderInkGroupNext,
    window_ms: f64,
) -> bool {
    let Some(group) = group else {
        return false;
    };
    if group.path_count >= INK_MAX_PATHS_PER_ANNOTATION {
        return false;
    }
    if group.page_index != next.page_index {
        return false;
    }
    if group.color != next.color {
        return false;
    }
    if group.width != next.width {
        return false;
    }
    next.at - group.last_at <= window_ms
}

/// TS `inkPathsHitTest`: whether `(x, y)` lies within `radius` of any segment of any path.
#[must_use]
pub fn ink_paths_hit_test(paths: &[Vec<f64>], x: f64, y: f64, radius: f64) -> bool {
    for path in paths {
        let points: Vec<(f64, f64)> = path
            .as_chunks::<2>()
            .0
            .iter()
            .map(|&[x, y]| (x, y))
            .collect();
        match points.as_slice() {
            [] => {}
            [(px, py)] => {
                if hypot(x - px, y - py) <= radius {
                    return true;
                }
            }
            _ => {
                for w in points.windows(2) {
                    let d = perpendicular_distance(x, y, w[0].0, w[0].1, w[1].0, w[1].1);
                    if d <= radius {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// TS `translateInkPaths`: move every path by `(dx, dy)`, rounded to `decimals`.
#[must_use]
pub fn translate_ink_paths(paths: &[Vec<f64>], dx: f64, dy: f64, decimals: f64) -> Vec<Vec<f64>> {
    let factor = 10_f64.powf(decimals);
    let round_to = |n: f64| round(n * factor) / factor;
    paths
        .iter()
        .map(|path| {
            let mut out = Vec::with_capacity(path.len());
            for c in path.as_chunks::<2>().0 {
                out.push(round_to(c[0] + dx));
                out.push(round_to(c[1] + dy));
            }
            out
        })
        .collect()
}

/// TS `inkPathsBounds`: `[minX, minY, maxX, maxY]` over every finite point, or `None` when there is none.
#[must_use]
pub fn ink_paths_bounds(paths: &[Vec<f64>]) -> Option<[f64; 4]> {
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for path in paths {
        for c in path.as_chunks::<2>().0 {
            let (x, y) = (c[0], c[1]);
            if !x.is_finite() || !y.is_finite() {
                continue;
            }
            min_x = min(min_x, x);
            max_x = max(max_x, x);
            min_y = min(min_y, y);
            max_y = max(max_y, y);
        }
    }
    if !min_x.is_finite() || !min_y.is_finite() {
        return None;
    }
    Some([min_x, min_y, max_x, max_y])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A hand-drawn-ish stroke: a sine wave sampled far denser than its shape needs.
    fn dense_stroke(samples: usize, amplitude: f64) -> Vec<f64> {
        let mut path = Vec::new();
        for i in 0..samples {
            let x = (i as f64 / samples as f64) * 300.0;
            path.push(x);
            path.push(400.0 + (i as f64 / 9.0).sin() * amplitude);
        }
        path
    }

    fn group() -> ReaderInkGroupCandidate {
        ReaderInkGroupCandidate {
            page_index: 3.0,
            color: "#ffd400".to_owned(),
            width: 2.0,
            path_count: 2.0,
            last_at: 1_000.0,
        }
    }

    fn next() -> ReaderInkGroupNext {
        ReaderInkGroupNext {
            page_index: 3.0,
            color: "#ffd400".to_owned(),
            width: 2.0,
            at: 1_500.0,
        }
    }

    #[test]
    fn should_append_ink_point_drops_samples_inside_the_pen_jitter() {
        assert!(should_append_ink_point(
            &[],
            10.0,
            10.0,
            INK_MIN_POINT_DISTANCE
        ));
        assert!(!should_append_ink_point(
            &[10.0, 10.0],
            10.1,
            10.1,
            INK_MIN_POINT_DISTANCE
        ));
        assert!(should_append_ink_point(
            &[10.0, 10.0],
            12.0,
            10.0,
            INK_MIN_POINT_DISTANCE
        ));
    }

    #[test]
    fn simplify_ink_path_keeps_the_endpoints_and_the_shape() {
        let path = dense_stroke(600, 6.0);
        let simplified = simplify_ink_path(&path, INK_SIMPLIFY_TOLERANCE);

        assert_eq!(simplified[0], path[0]);
        assert_eq!(simplified[1], path[1]);
        assert_eq!(simplified[simplified.len() - 2], path[path.len() - 2]);
        assert_eq!(simplified[simplified.len() - 1], path[path.len() - 1]);
        assert!(
            simplified.len() < path.len() / 3,
            "expected a large reduction"
        );
    }

    #[test]
    fn simplify_ink_path_collapses_a_straight_line_to_its_two_ends() {
        let mut straight = Vec::new();
        for i in 0..=50 {
            straight.push(f64::from(i) * 2.0);
            straight.push(100.0);
        }
        assert_eq!(
            simplify_ink_path(&straight, INK_SIMPLIFY_TOLERANCE),
            vec![0.0, 100.0, 100.0, 100.0]
        );
    }

    #[test]
    fn simplify_ink_path_handles_a_stroke_long_enough_to_blow_a_recursive_stack() {
        let mut huge = Vec::new();
        for i in 0..60_000 {
            huge.push(f64::from(i) * 0.01);
            huge.push(100.0 + f64::from(i % 2) * 0.9);
        }
        assert!(!simplify_ink_path(&huge, 0.001).is_empty());
    }

    #[test]
    fn quantize_ink_path_rounds_away_device_float_noise() {
        assert_eq!(
            quantize_ink_path(&[1.234567, 8.7654321], INK_COORD_DECIMALS),
            vec![1.23, 8.77]
        );
        assert!(quantize_ink_path(&[1.0, f64::NAN], INK_COORD_DECIMALS).is_empty());
    }

    #[test]
    fn compact_ink_path_cuts_a_captured_stroke_to_a_fraction_of_its_stored_size() {
        let raw = dense_stroke(800, 6.0);
        let compact = compact_ink_path(&raw, &ReaderCompactInkOptions::default());

        assert!(compact.len() >= 4);
        assert!(ink_path_json_size(&compact) < ink_path_json_size(&raw) / 10);
    }

    #[test]
    fn compact_ink_path_caps_even_a_pathological_scribble() {
        let mut scribble = Vec::new();
        for i in 0..20_000 {
            scribble.push(f64::from(i) * 0.5);
            scribble.push(300.0 + if i % 2 == 0 { 40.0 } else { -40.0 });
        }

        let compact = compact_ink_path(&scribble, &ReaderCompactInkOptions::default());

        assert!(
            compact.len() / 2 <= 400,
            "cap breached: {} points",
            compact.len() / 2
        );
        assert_eq!(compact[compact.len() - 2], scribble[scribble.len() - 2]);
        assert_eq!(compact[compact.len() - 1], scribble[scribble.len() - 1]);
    }

    #[test]
    fn compact_ink_path_refuses_anything_that_is_not_a_stroke() {
        let opts = ReaderCompactInkOptions::default();
        assert!(compact_ink_path(&[], &opts).is_empty());
        assert!(compact_ink_path(&[1.0, 2.0], &opts).is_empty());
        assert!(compact_ink_path(&[1.0, 2.0, f64::INFINITY, 4.0], &opts).is_empty());
    }

    #[test]
    fn ink_width_for_pressure_separates_a_pen_from_a_mouse() {
        assert_eq!(
            ink_width_for_pressure(None, INK_DEFAULT_WIDTH),
            INK_DEFAULT_WIDTH
        );
        assert_eq!(
            ink_width_for_pressure(Some(0.0), INK_DEFAULT_WIDTH),
            INK_DEFAULT_WIDTH
        );
        assert_eq!(
            ink_width_for_pressure(Some(0.5), INK_DEFAULT_WIDTH),
            INK_DEFAULT_WIDTH
        );

        let light = ink_width_for_pressure(Some(0.1), INK_DEFAULT_WIDTH);
        let heavy = ink_width_for_pressure(Some(1.0), INK_DEFAULT_WIDTH);
        assert!(
            light < INK_DEFAULT_WIDTH,
            "light press should thin the stroke, got {light}"
        );
        assert!(
            heavy > INK_DEFAULT_WIDTH,
            "full press should thicken it, got {heavy}"
        );
    }

    #[test]
    fn clamp_ink_width_keeps_a_stroke_drawable() {
        assert_eq!(clamp_ink_width(f64::NAN), INK_DEFAULT_WIDTH);
        assert_eq!(clamp_ink_width(0.0), 0.25);
        assert_eq!(clamp_ink_width(1_000.0), 24.0);
    }

    #[test]
    fn ink_nib_widths_pt_is_the_ink_note_nib_set_in_points() {
        assert_eq!(ink_nib_widths_pt(), [0.28, 0.85, 1.42, 1.98]);
        assert_eq!(ink_nib_default_pt(), 1.42, "the default is the 0.5 mm pen");
        for nib in ink_nib_widths_pt() {
            assert_eq!(clamp_ink_width(nib), nib, "{nib} pt must survive the clamp");
        }
    }

    #[test]
    fn a_nib_converts_one_way_from_the_note_unit_to_points() {
        assert_eq!(ink_note_width_to_pdf_points(3.0), ink_nib_widths_pt()[1]);
        assert_eq!(
            ink_note_width_to_pdf_points(crate::ink::width::INK_PEN_WIDTH),
            0.85
        );
        assert_eq!(ink_note_width_to_pdf_points(f64::NAN), INK_DEFAULT_WIDTH);
    }

    #[test]
    fn mean_pressure_ignores_samples_from_devices_that_report_nothing() {
        assert_eq!(mean_pressure(&[0.0, 0.0, 0.0]), None);
        assert_eq!(mean_pressure(&[0.4, 0.6]), Some(0.5));
    }

    #[test]
    fn is_highlighter_ink_keys_off_the_stored_width() {
        assert!(!is_highlighter_ink(None));
        assert!(!is_highlighter_ink(Some(2.0)));
        assert!(is_highlighter_ink(Some(HIGHLIGHTER_MIN_WIDTH)));
    }

    #[test]
    fn can_join_ink_group_merges_strokes_of_one_mark_and_splits_everything_else() {
        let g = group();
        let n = next();

        assert!(can_join_ink_group(Some(&g), &n, INK_GROUP_WINDOW_MS));
        assert!(!can_join_ink_group(None, &n, INK_GROUP_WINDOW_MS));

        let idle = ReaderInkGroupNext {
            at: 9_000.0,
            ..next()
        };
        assert!(
            !can_join_ink_group(Some(&g), &idle, INK_GROUP_WINDOW_MS),
            "idle gap splits"
        );

        let page = ReaderInkGroupNext {
            page_index: 4.0,
            ..next()
        };
        assert!(!can_join_ink_group(Some(&g), &page, INK_GROUP_WINDOW_MS));

        let colour = ReaderInkGroupNext {
            color: "#ff6666".to_owned(),
            ..next()
        };
        assert!(!can_join_ink_group(Some(&g), &colour, INK_GROUP_WINDOW_MS));

        let nib = ReaderInkGroupNext {
            width: 14.0,
            ..next()
        };
        assert!(
            !can_join_ink_group(Some(&g), &nib, INK_GROUP_WINDOW_MS),
            "a different nib is a different mark"
        );

        let full = ReaderInkGroupCandidate {
            path_count: 64.0,
            ..group()
        };
        assert!(
            !can_join_ink_group(Some(&full), &n, INK_GROUP_WINDOW_MS),
            "a full annotation must not grow without bound"
        );
    }

    #[test]
    fn ink_paths_hit_test_matches_the_stroke_not_its_bounding_box() {
        let paths = vec![vec![0.0, 100.0, 0.0, 0.0, 100.0, 0.0]];
        assert!(ink_paths_hit_test(&paths, 0.0, 50.0, 3.0));
        assert!(ink_paths_hit_test(&paths, 50.0, 0.0, 3.0));
        assert!(
            !ink_paths_hit_test(&paths, 100.0, 100.0, 3.0),
            "empty corner must not erase"
        );
        assert!(
            ink_paths_hit_test(&paths, 2.0, 50.0, 3.0),
            "the radius is honoured"
        );
    }

    #[test]
    fn translate_ink_paths_moves_every_stroke_and_keeps_stored_precision() {
        assert_eq!(
            translate_ink_paths(
                &[vec![0.0, 0.0, 10.0, 10.0]],
                1.006,
                -2.0,
                INK_COORD_DECIMALS
            ),
            vec![vec![1.01, -2.0, 11.01, 8.0]]
        );
    }

    #[test]
    fn ink_paths_bounds_spans_every_stroke() {
        assert_eq!(
            ink_paths_bounds(&[vec![0.0, 0.0, 5.0, 5.0], vec![-3.0, 2.0, 1.0, 9.0]]),
            Some([-3.0, 0.0, 5.0, 9.0])
        );
        assert_eq!(ink_paths_bounds(&[]), None);
    }

    #[test]
    fn ink_path_json_size_matches_json_stringify_length() {
        assert_eq!(ink_path_json_size(&[]), 2);
        // JSON.stringify([NaN, -0, 1e21, 1.5e-7]) === "[null,0,1e+21,1.5e-7]"
        assert_eq!(ink_path_json_size(&[f64::NAN, -0.0, 1e21, 1.5e-7]), 21);
    }
}
