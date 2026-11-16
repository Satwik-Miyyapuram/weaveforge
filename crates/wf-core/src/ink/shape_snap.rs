//! Shape snap: fits a line, rect, ellipse or arrow to a freehand mark.
//! Port of `apps/web/src/features/ink/application/shape-snap` (geometry, line,
//! rect, ellipse, arrow, fit) and the worker's `snapShape` in
//! `apps/web/src/features/ink/worker/ink-worker.ts`. Float operations keep TS order.

use super::ink_page::InkShape;
use super::js_math::{hypot, max, min, round};
use std::f64::consts::{FRAC_PI_2, PI, SQRT_2};

const SHAPE_MIN_SPAN: f64 = 50.0;
const SHAPE_MIN_POINTS: usize = 2;
const LINE_ERROR_LIMIT: f64 = 0.04;
const LINE_BACKTRACK_LIMIT: f64 = 0.035;
const LINE_MIN_SEGMENT_COS: f64 = -0.25;
const CLOSED_GAP_LIMIT: f64 = 0.25;
const RECT_MIN_PERIMETER_RATIO: f64 = 1.9;
const RECT_MIN_MINOR_RATIO: f64 = 0.25;
const RECT_BAND_LIMIT: f64 = 0.06;
const RECT_CORNER_SUPPORT: f64 = 0.25;
const RECT_CORNER_BAND: f64 = 0.12;
const RECT_TILT_LIMIT_DEGREES: f64 = 7.0;
const ELLIPSE_MIN_AXIS_RATIO: f64 = 0.2;
const ELLIPSE_ERROR_LIMIT: f64 = 0.08;
const ELLIPSE_GAP_LIMIT: f64 = 0.25;
const CIRCLE_MODULATION: f64 = 0.1;
const ARROW_MIN_HEAD_REACH: f64 = 0.05;
const ARROW_MIN_PATH_RATIO: f64 = 1.12;
const ARROW_MAX_HEAD_RATIO: f64 = 0.5;
const ARROW_MIN_OPENING_DEGREES: f64 = 15.0;
const ARROW_MAX_OPENING_DEGREES: f64 = 150.0;
const ARROW_SHAFT_ERROR_LIMIT: f64 = 0.06;
const SHAPE_ACCEPT_MARGIN: f64 = 0.15;
const SHAPE_MIN_CONFIDENCE: f64 = 0.25;
const SHAPE_RESAMPLE_SPACING: f64 = 2.0;
const ELLIPSE_PATH_STEPS: usize = 64;
const SNAP_EDGE_STEP: f64 = 10.0;

/// A point in 0.1 mm, as `[x, y]`.
pub type SnapPoint = [f64; 2];

/// The four primitives plus the abstention, in `InkShape` order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapShape {
    /// No primitive fits.
    None,
    /// A straight line.
    Line,
    /// A quadrilateral.
    Rect,
    /// An ellipse or circle.
    Ellipse,
    /// A shaft with a head.
    Arrow,
}

impl SnapShape {
    /// The shape the ink model stores for this one.
    #[must_use]
    pub fn ink_shape(self) -> InkShape {
        match self {
            Self::None => InkShape::None,
            Self::Line => InkShape::Line,
            Self::Rect => InkShape::Rect,
            Self::Ellipse => InkShape::Ellipse,
            Self::Arrow => InkShape::Arrow,
        }
    }
}

/// A straight mark from `start` to `end`.
#[derive(Debug, Clone, PartialEq)]
pub struct LineGeometry {
    /// Fitted start point.
    pub start: SnapPoint,
    /// Fitted end point.
    pub end: SnapPoint,
    /// Length in 0.1 mm.
    pub length: f64,
}

/// A quadrilateral in draw order, closed back to its first corner.
#[derive(Debug, Clone, PartialEq)]
pub struct RectGeometry {
    /// The four fitted vertices.
    pub corners: [SnapPoint; 4],
    /// Always `true`: the renderer closes the loop.
    pub closed: bool,
    /// Fitted rotation in degrees.
    pub rotation_degrees: f64,
}

/// A centre-form ellipse.
#[derive(Debug, Clone, PartialEq)]
pub struct EllipseGeometry {
    /// Centre point.
    pub centre: SnapPoint,
    /// Semi-axis along the rotated x direction.
    pub radius_x: f64,
    /// Semi-axis along the rotated y direction.
    pub radius_y: f64,
    /// Major-axis rotation in degrees.
    pub rotation_degrees: f64,
    /// `true` when the radii differ by less than the circle modulation.
    pub circle: bool,
}

/// A shaft with a two-barbed head.
#[derive(Debug, Clone, PartialEq)]
pub struct ArrowGeometry {
    /// Shaft start.
    pub start: SnapPoint,
    /// Shaft tip.
    pub tip: SnapPoint,
    /// The two barb vertices in pen order.
    pub head: [SnapPoint; 2],
    /// The shaft polyline from `start` to `tip`.
    pub shaft_path: Vec<SnapPoint>,
    /// The head as `tip, barb0, tip, barb1`.
    pub head_path: Vec<SnapPoint>,
}

/// Any fitted primitive, discriminated by variant.
#[derive(Debug, Clone, PartialEq)]
pub enum SnapGeometry {
    /// A line.
    Line(LineGeometry),
    /// A rectangle.
    Rect(RectGeometry),
    /// An ellipse.
    Ellipse(EllipseGeometry),
    /// An arrow.
    Arrow(ArrowGeometry),
}

/// One fitted candidate: its shape, residual and confidence.
#[derive(Debug, Clone, PartialEq)]
pub struct ShapeFit {
    /// The fitted shape.
    pub shape: SnapShape,
    /// Mean residual, comparable across candidates.
    pub error: f64,
    /// `[0, 1]`, `0` for a refused fit.
    pub confidence: f64,
    /// The fitted geometry.
    pub geometry: SnapGeometry,
}

/// Every primitive's fit, computed together.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ShapeFits {
    /// Line fit, if any.
    pub line: Option<ShapeFit>,
    /// Rect fit, if any.
    pub rect: Option<ShapeFit>,
    /// Ellipse fit, if any.
    pub ellipse: Option<ShapeFit>,
    /// Arrow fit, if any.
    pub arrow: Option<ShapeFit>,
}

/// The recogniser's answer: the winner or abstention, plus every fit behind it.
#[derive(Debug, Clone, PartialEq)]
pub struct ShapeRecognition {
    /// The winning shape, `None` when abstaining.
    pub shape: SnapShape,
    /// The winning fit, `None` exactly when `shape` is `None`.
    pub fit: Option<ShapeFit>,
    /// Every primitive's fit.
    pub fits: ShapeFits,
}

/// A snapped mark: flat edge-sampled points and the shape it was fitted as.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SnappedShape {
    /// Flat `[x0, y0, x1, y1, …]` in 0.1 mm.
    pub points: Vec<f64>,
    /// The fitted shape.
    pub shape: InkShape,
}

/// An axis-aligned box in 0.1 mm, extremes inclusive.
#[derive(Debug, Clone, Copy, PartialEq)]
struct SnapBounds {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

/// Fits the mark and returns its edge-sampled path, or `None` when the recogniser abstains.
#[must_use]
pub fn snap_ink_shape(points: &[f64]) -> Option<SnappedShape> {
    let fit = recognise_shape(points).fit?;
    let paths = match &fit.geometry {
        SnapGeometry::Arrow(arrow) => vec![arrow.shaft_path.clone(), arrow.head_path.clone()],
        geometry => vec![fitted_ink_path(geometry)],
    };
    let mut flat: Vec<f64> = Vec::new();
    for path in &paths {
        let mut previous: Option<SnapPoint> = None;
        for &[x, y] in path {
            if let Some([px, py]) = previous {
                // Sample each straight edge so packing keeps the corners.
                let steps = (hypot(x - px, y - py) / SNAP_EDGE_STEP).floor();
                let mut k = 1.0;
                while k < steps {
                    flat.push(px + ((x - px) * k) / steps);
                    flat.push(py + ((y - py) * k) / steps);
                    k += 1.0;
                }
            }
            flat.push(x);
            flat.push(y);
            previous = Some([x, y]);
        }
    }
    if flat.len() < 4 {
        return None;
    }
    Some(SnappedShape {
        points: flat,
        shape: fit.shape.ink_shape(),
    })
}

fn recognise_shape(path: &[f64]) -> ShapeRecognition {
    let fits = fit_all_shapes(path);
    let fit = winner(&fits);
    let shape = fit.as_ref().map_or(SnapShape::None, |found| found.shape);
    ShapeRecognition { shape, fit, fits }
}

fn fit_all_shapes(path: &[f64]) -> ShapeFits {
    ShapeFits {
        line: fit_line(path),
        rect: fit_rect(path),
        ellipse: fit_ellipse(path),
        arrow: fit_arrow(path),
    }
}

fn winner(fits: &ShapeFits) -> Option<ShapeFit> {
    let mut candidates: Vec<&ShapeFit> = fits.line.iter().collect();
    candidates.extend(
        fits.rect
            .iter()
            .filter(|fit| rect_rotation(fit) <= RECT_TILT_LIMIT_DEGREES),
    );
    candidates.extend(fits.ellipse.iter());
    candidates.extend(fits.arrow.iter());
    let (&first, rest) = candidates.split_first()?;
    let mut best = first;
    let mut second_best = f64::INFINITY;
    for &candidate in rest {
        if candidate.error < best.error {
            second_best = best.error;
            best = candidate;
        } else if candidate.error < second_best {
            second_best = candidate.error;
        }
    }
    let beats_rival =
        second_best == f64::INFINITY || best.error <= second_best * (1.0 - SHAPE_ACCEPT_MARGIN);
    if !beats_rival || best.confidence < SHAPE_MIN_CONFIDENCE {
        return None;
    }
    Some(best.clone())
}

fn rect_rotation(fit: &ShapeFit) -> f64 {
    match &fit.geometry {
        SnapGeometry::Rect(rect) => rect.rotation_degrees,
        _ => f64::INFINITY,
    }
}

fn fitted_ink_path(geometry: &SnapGeometry) -> Vec<SnapPoint> {
    match geometry {
        SnapGeometry::Line(line) => vec![line.start, line.end],
        SnapGeometry::Rect(rect) => {
            let c = rect.corners;
            vec![c[0], c[1], c[2], c[3], c[0]]
        }
        SnapGeometry::Ellipse(ellipse) => ellipse_path(ellipse),
        SnapGeometry::Arrow(arrow) => arrow.shaft_path.clone(),
    }
}

fn ellipse_path(ellipse: &EllipseGeometry) -> Vec<SnapPoint> {
    let rotation = (ellipse.rotation_degrees * PI) / 180.0;
    let (cos, sin) = (rotation.cos(), rotation.sin());
    (0..=ELLIPSE_PATH_STEPS)
        .map(|i| {
            let angle = (i as f64 / ELLIPSE_PATH_STEPS as f64) * PI * 2.0;
            let u = ellipse.radius_x * angle.cos();
            let v = ellipse.radius_y * angle.sin();
            [
                round(ellipse.centre[0] + u * cos - v * sin),
                round(ellipse.centre[1] + u * sin + v * cos),
            ]
        })
        .collect()
}

fn snap_points(path: &[f64]) -> Vec<SnapPoint> {
    let mut points = Vec::with_capacity(path.len() / 2);
    for &[x, y] in path.as_chunks::<2>().0 {
        if x.is_finite() && y.is_finite() {
            points.push([round(x), round(y)]);
        }
    }
    points
}

fn snap_bounds(points: &[SnapPoint]) -> Option<SnapBounds> {
    let first = *points.first()?;
    let mut bounds = SnapBounds {
        min_x: first[0],
        min_y: first[1],
        max_x: first[0],
        max_y: first[1],
    };
    for &[x, y] in points {
        if x < bounds.min_x {
            bounds.min_x = x;
        }
        if x > bounds.max_x {
            bounds.max_x = x;
        }
        if y < bounds.min_y {
            bounds.min_y = y;
        }
        if y > bounds.max_y {
            bounds.max_y = y;
        }
    }
    Some(bounds)
}

fn resample_path(path: &[f64]) -> Vec<SnapPoint> {
    let points = snap_points(path);
    if points.len() <= 2 {
        return points;
    }
    let (Some(&first), Some(&end)) = (points.first(), points.last()) else {
        return Vec::new();
    };
    let mut kept = vec![first];
    for &point in points.iter().skip(1).take(points.len() - 2) {
        let last = kept.last().copied().unwrap_or(first);
        if hypot(point[0] - last[0], point[1] - last[1]) >= SHAPE_RESAMPLE_SPACING {
            kept.push(point);
        }
    }
    let last = kept.last().copied().unwrap_or(first);
    if end[0] != last[0] || end[1] != last[1] {
        kept.push(end);
    }
    kept
}

fn path_length(points: &[SnapPoint]) -> f64 {
    let mut total = 0.0;
    for pair in points.windows(2) {
        if let &[a, b] = pair {
            total += hypot(b[0] - a[0], b[1] - a[1]);
        }
    }
    total
}

fn bounding_span(bounds: &SnapBounds) -> f64 {
    hypot(bounds.max_x - bounds.min_x, bounds.max_y - bounds.min_y)
}

#[derive(Debug, Clone, Copy)]
struct PrincipalAxis {
    cx: f64,
    cy: f64,
    dir_x: f64,
    dir_y: f64,
    major: f64,
    minor: f64,
}

fn principal_axis(points: &[SnapPoint]) -> PrincipalAxis {
    let n = points.len() as f64;
    let mut cx = 0.0;
    let mut cy = 0.0;
    for &[x, y] in points {
        cx += x;
        cy += y;
    }
    cx /= n;
    cy /= n;
    let (mut sxx, mut syy, mut sxy) = (0.0, 0.0, 0.0);
    for &[x, y] in points {
        let dx = x - cx;
        let dy = y - cy;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
    }
    sxx /= n;
    syy /= n;
    sxy /= n;
    let angle = 0.5 * (2.0 * sxy).atan2(sxx - syy);
    let (cos, sin) = (angle.cos(), angle.sin());
    let major = max(
        0.0,
        sxx * cos * cos + 2.0 * sxy * cos * sin + syy * sin * sin,
    )
    .sqrt();
    let minor = max(
        0.0,
        sxx * sin * sin - 2.0 * sxy * cos * sin + syy * cos * cos,
    )
    .sqrt();
    PrincipalAxis {
        cx,
        cy,
        dir_x: cos,
        dir_y: sin,
        major,
        minor,
    }
}

fn mean_deviation(points: &[SnapPoint], distance: impl Fn(f64, f64) -> f64) -> f64 {
    let mut total = 0.0;
    for &[x, y] in points {
        total += distance(x, y);
    }
    total / points.len() as f64
}

fn confidence_of(error: f64, limit: f64) -> f64 {
    if !(limit > 0.0) {
        return 0.0;
    }
    max(0.0, min(1.0, 1.0 - error / limit))
}

fn fit_line(path: &[f64]) -> Option<ShapeFit> {
    let points = resample_path(path);
    if points.len() < SHAPE_MIN_POINTS {
        return None;
    }
    let span = bounding_span(&snap_bounds(&points)?);
    if span < SHAPE_MIN_SPAN {
        return None;
    }
    let first = *points.first()?;
    let last = *points.last()?;
    let axis = principal_axis(&points);
    let (cx, cy, dir_x, dir_y) = (axis.cx, axis.cy, axis.dir_x, axis.dir_y);
    let projections: Vec<f64> = points
        .iter()
        .map(|&[x, y]| (x - cx) * dir_x + (y - cy) * dir_y)
        .collect();
    let mut backtrack = 0.0;
    for pair in projections.windows(2) {
        if let &[before, after] = pair {
            backtrack = max(backtrack, before - after);
        }
    }
    let mut worst_cos = 1.0;
    for triple in points.windows(3) {
        let &[p0, p1, p2] = triple else {
            continue;
        };
        let (ax, ay) = (p1[0] - p0[0], p1[1] - p0[1]);
        let (bx, by) = (p2[0] - p1[0], p2[1] - p1[1]);
        let (a, b) = (hypot(ax, ay), hypot(bx, by));
        if a < 1e-9 || b < 1e-9 {
            continue;
        }
        worst_cos = min(worst_cos, (ax * bx + ay * by) / (a * b));
    }
    if backtrack > LINE_BACKTRACK_LIMIT * span || worst_cos < LINE_MIN_SEGMENT_COS {
        return None;
    }
    let error = mean_deviation(&points, |x, y| ((x - cx) * -dir_y + (y - cy) * dir_x).abs()) / span;
    if error > LINE_ERROR_LIMIT {
        return None;
    }
    let at = |point: SnapPoint| {
        let t = (point[0] - cx) * dir_x + (point[1] - cy) * dir_y;
        [round(cx + dir_x * t), round(cy + dir_y * t)]
    };
    let (start, end) = (at(first), at(last));
    Some(ShapeFit {
        shape: SnapShape::Line,
        error,
        confidence: confidence_of(error, LINE_ERROR_LIMIT),
        geometry: SnapGeometry::Line(LineGeometry {
            start,
            end,
            length: hypot(end[0] - start[0], end[1] - start[1]),
        }),
    })
}

fn fit_rect(path: &[f64]) -> Option<ShapeFit> {
    let points = resample_path(path);
    if points.len() < 4 {
        return None;
    }
    let span = bounding_span(&snap_bounds(&points)?);
    if span < SHAPE_MIN_SPAN {
        return None;
    }
    let first = *points.first()?;
    let last = *points.last()?;
    if hypot(last[0] - first[0], last[1] - first[1]) > CLOSED_GAP_LIMIT * span {
        return None;
    }
    if path_length(&points) < RECT_MIN_PERIMETER_RATIO * span {
        return None;
    }
    let (angle, frame) = minimum_area_box(&points)?;
    let width = frame.max_u - frame.min_u;
    let height = frame.max_v - frame.min_v;
    if width <= 0.0 || height <= 0.0 {
        return None;
    }
    if min(width, height) / max(width, height) < RECT_MIN_MINOR_RATIO {
        return None;
    }
    let local: Vec<SnapPoint> = points
        .iter()
        .map(|&[x, y]| [x * frame.ux + y * frame.uy, x * frame.vx + y * frame.vy])
        .collect();
    let error = mean_deviation(&local, |u, v| {
        let du = max(frame.min_u - u, u - frame.max_u);
        let dv = max(frame.min_v - v, v - frame.max_v);
        max(0.0, max(du, dv))
    }) / span;
    if error > RECT_BAND_LIMIT {
        return None;
    }
    let to_page = |u: f64, v: f64| {
        [
            round(u * frame.ux + v * frame.vx),
            round(u * frame.uy + v * frame.vy),
        ]
    };
    let raw: [SnapPoint; 4] = [
        to_page(frame.min_u, frame.min_v),
        to_page(frame.max_u, frame.min_v),
        to_page(frame.max_u, frame.max_v),
        to_page(frame.min_u, frame.max_v),
    ];
    let corner_band = RECT_CORNER_BAND * max(width, height);
    let near_corner = points
        .iter()
        .filter(|&&[x, y]| raw.iter().any(|c| hypot(x - c[0], y - c[1]) <= corner_band))
        .count();
    if (near_corner as f64) / (points.len() as f64) < RECT_CORNER_SUPPORT {
        return None;
    }
    Some(ShapeFit {
        shape: SnapShape::Rect,
        error,
        confidence: confidence_of(error, RECT_BAND_LIMIT),
        geometry: SnapGeometry::Rect(RectGeometry {
            corners: ordered_corners(&raw, first, last),
            closed: true,
            rotation_degrees: normalise_axis_degrees(angle),
        }),
    })
}

/// Walks the corners from the one nearest the first sample, in the pen's direction.
fn ordered_corners(raw: &[SnapPoint; 4], first: SnapPoint, last: SnapPoint) -> [SnapPoint; 4] {
    let mut start_index = 0;
    let mut best_distance = f64::INFINITY;
    for (i, corner) in raw.iter().enumerate() {
        let distance = hypot(corner[0] - first[0], corner[1] - first[1]);
        if distance < best_distance {
            best_distance = distance;
            start_index = i;
        }
    }
    let toward_last = |index: usize| {
        let corner = raw[index % 4];
        hypot(corner[0] - last[0], corner[1] - last[1])
    };
    let next = (start_index + 1) % 4;
    let previous = (start_index + 3) % 4;
    let clockwise = toward_last(next) <= toward_last(previous);
    std::array::from_fn(|i| {
        let step = if clockwise { i } else { 4 - i };
        raw[(start_index + step) % 4]
    })
}

#[derive(Debug, Clone, Copy)]
struct Extent {
    ux: f64,
    uy: f64,
    vx: f64,
    vy: f64,
    min_u: f64,
    max_u: f64,
    min_v: f64,
    max_v: f64,
    area: f64,
}

fn extent_at(points: &[SnapPoint], angle: f64) -> Extent {
    let ux = angle.cos();
    let uy = angle.sin();
    let vx = -uy;
    let vy = ux;
    let (mut min_u, mut max_u) = (f64::INFINITY, f64::NEG_INFINITY);
    let (mut min_v, mut max_v) = (f64::INFINITY, f64::NEG_INFINITY);
    for &[x, y] in points {
        let u = x * ux + y * uy;
        let v = x * vx + y * vy;
        if u < min_u {
            min_u = u;
        }
        if u > max_u {
            max_u = u;
        }
        if v < min_v {
            min_v = v;
        }
        if v > max_v {
            max_v = v;
        }
    }
    Extent {
        ux,
        uy,
        vx,
        vy,
        min_u,
        max_u,
        min_v,
        max_v,
        area: (max_u - min_u) * (max_v - min_v),
    }
}

/// The minimum-area box over the segment directions, refined by golden-section search.
fn minimum_area_box(points: &[SnapPoint]) -> Option<(f64, Extent)> {
    let mut candidates = Vec::with_capacity(points.len());
    for pair in points.windows(2) {
        if let &[a, b] = pair {
            candidates.push((b[1] - a[1]).atan2(b[0] - a[0]));
        }
    }
    let mut best_angle = *candidates.first()?;
    let mut best = extent_at(points, best_angle);
    for &candidate in &candidates {
        let extent = extent_at(points, candidate);
        if extent.area < best.area {
            best = extent;
            best_angle = candidate;
        }
    }
    let golden = (5.0_f64.sqrt() - 1.0) / 2.0;
    for direction in [-1.0, 1.0] {
        let mut low = 0.0;
        let mut high = FRAC_PI_2;
        let mut x1 = high - golden * (high - low);
        let mut x2 = low + golden * (high - low);
        let mut f1 = extent_at(points, best_angle + direction * x1).area;
        let mut f2 = extent_at(points, best_angle + direction * x2).area;
        for _ in 0..32 {
            if f1 < f2 {
                high = x2;
                x2 = x1;
                f2 = f1;
                x1 = high - golden * (high - low);
                f1 = extent_at(points, best_angle + direction * x1).area;
            } else {
                low = x1;
                x1 = x2;
                f1 = f2;
                x2 = low + golden * (high - low);
                f2 = extent_at(points, best_angle + direction * x2).area;
            }
        }
        let refined_angle = best_angle + (direction * (low + high)) / 2.0;
        let refined = extent_at(points, refined_angle);
        if refined.area < best.area {
            best = refined;
            best_angle = refined_angle;
        }
    }
    Some((best_angle, best))
}

fn normalise_axis_degrees(degrees: f64) -> f64 {
    let wrapped = ((degrees % 90.0) + 90.0) % 90.0;
    if wrapped > 45.0 {
        90.0 - wrapped
    } else {
        wrapped
    }
}

/// How far the radius from the fitted centre swings, over the mean radius.
fn radial_modulation(points: &[SnapPoint], axis: &PrincipalAxis) -> f64 {
    let (cx, cy, dir_x, dir_y) = (axis.cx, axis.cy, axis.dir_x, axis.dir_y);
    let (ux, uy) = (-dir_y, dir_x);
    let mut radius_sum = 0.0;
    let mut radius_min = f64::INFINITY;
    let mut radius_max = 0.0;
    for &[x, y] in points {
        let u = (x - cx) * dir_x + (y - cy) * dir_y;
        let v = (x - cx) * ux + (y - cy) * uy;
        let radius = hypot(u, v);
        radius_sum += radius;
        if radius < radius_min {
            radius_min = radius;
        }
        if radius > radius_max {
            radius_max = radius;
        }
    }
    let mean_radius = radius_sum / points.len() as f64;
    if mean_radius > 0.0 {
        (radius_max - radius_min) / mean_radius
    } else {
        0.0
    }
}

fn fit_ellipse(path: &[f64]) -> Option<ShapeFit> {
    let points = resample_path(path);
    if points.len() < 5 {
        return None;
    }
    let span = bounding_span(&snap_bounds(&points)?);
    if span < SHAPE_MIN_SPAN {
        return None;
    }
    let first = *points.first()?;
    let last = *points.last()?;
    if hypot(last[0] - first[0], last[1] - first[1]) > ELLIPSE_GAP_LIMIT * span {
        return None;
    }
    let axis = principal_axis(&points);
    if axis.major <= 0.0 || axis.minor <= 0.0 {
        return None;
    }
    if axis.minor / axis.major < ELLIPSE_MIN_AXIS_RATIO {
        return None;
    }
    let (cx, cy, dir_x, dir_y) = (axis.cx, axis.cy, axis.dir_x, axis.dir_y);
    // Spreads are semi-axes over √2 for a closed curve, so put the factor back.
    let radius_major = axis.major * SQRT_2;
    let radius_minor = axis.minor * SQRT_2;
    let (ux, uy) = (-dir_y, dir_x);
    let unit = |x: f64, y: f64| {
        let u = (x - cx) * dir_x + (y - cy) * dir_y;
        let v = (x - cx) * ux + (y - cy) * uy;
        let r = hypot(u / radius_major, v / radius_minor);
        if r <= 0.0 {
            radius_major
        } else {
            (r - 1.0).abs() * radius_major
        }
    };
    let error = mean_deviation(&points, unit) / radius_major;
    if error > ELLIPSE_ERROR_LIMIT {
        return None;
    }
    let modulation = radial_modulation(&points, &axis);
    Some(ShapeFit {
        shape: SnapShape::Ellipse,
        error,
        confidence: confidence_of(error, ELLIPSE_ERROR_LIMIT),
        geometry: SnapGeometry::Ellipse(EllipseGeometry {
            centre: [round(cx), round(cy)],
            radius_x: round(radius_major),
            radius_y: round(radius_minor),
            rotation_degrees: (dir_y.atan2(dir_x) * 180.0) / PI,
            circle: modulation <= CIRCLE_MODULATION,
        }),
    })
}

#[allow(clippy::manual_range_contains)]
/// The last local maximum of `reach`: where the pen turned back.
fn arrow_tip_index(reach: &[f64]) -> Option<usize> {
    let mut tip_index = None;
    for (j, triple) in reach.windows(3).enumerate() {
        if let &[before, at, after] = triple
            && at > before
            && at >= after
        {
            tip_index = Some(j + 1);
        }
    }
    tip_index
}

fn fit_arrow(path: &[f64]) -> Option<ShapeFit> {
    let points = resample_path(path);
    if points.len() < 4 {
        return None;
    }
    let span = bounding_span(&snap_bounds(&points)?);
    if span < SHAPE_MIN_SPAN {
        return None;
    }
    // The tip is the last local maximum of distance from where the pen went down.
    let start = *points.first()?;
    let reach: Vec<f64> = points
        .iter()
        .map(|&[x, y]| hypot(x - start[0], y - start[1]))
        .collect();
    let tip_index = arrow_tip_index(&reach)?;
    let farthest = reach.get(tip_index).copied()?;
    let tip = *points.get(tip_index)?;
    if tip_index < 2 || tip_index + 3 > points.len() {
        return None;
    }
    if farthest < ARROW_MIN_HEAD_REACH * span {
        return None;
    }
    let head = points.get(tip_index + 1..)?;
    let head_reach = head.iter().fold(f64::NEG_INFINITY, |acc, &[x, y]| {
        max(acc, hypot(x - start[0], y - start[1]))
    });
    if head_reach > farthest * ARROW_MAX_HEAD_RATIO {
        return None;
    }
    if path_length(&points) < ARROW_MIN_PATH_RATIO * farthest {
        return None;
    }
    let shaft = points.get(..=tip_index)?;
    let axis = principal_axis(shaft);
    let (cx, cy, dir_x, dir_y) = (axis.cx, axis.cy, axis.dir_x, axis.dir_y);
    let shaft_error =
        mean_deviation(shaft, |x, y| ((x - cx) * -dir_y + (y - cy) * dir_x).abs()) / farthest;
    if shaft_error > ARROW_SHAFT_ERROR_LIMIT {
        return None;
    }
    let project = |[x, y]: SnapPoint| {
        let t = (x - cx) * dir_x + (y - cy) * dir_y;
        [round(cx + dir_x * t), round(cy + dir_y * t)]
    };
    let base = project(start);
    let shaft_tip = project(tip);
    let (barb_a, barb_b) = arrow_barbs(head, base, tip)?;
    let opening = opening_degrees(tip, barb_a, barb_b);
    if opening < ARROW_MIN_OPENING_DEGREES || opening > ARROW_MAX_OPENING_DEGREES {
        return None;
    }
    Some(ShapeFit {
        shape: SnapShape::Arrow,
        error: shaft_error,
        confidence: confidence_of(shaft_error, ARROW_SHAFT_ERROR_LIMIT),
        geometry: SnapGeometry::Arrow(ArrowGeometry {
            start: base,
            tip: shaft_tip,
            head: [barb_a, barb_b],
            shaft_path: vec![base, shaft_tip],
            head_path: vec![shaft_tip, barb_a, shaft_tip, barb_b],
        }),
    })
}

/// The two head samples that swing widest off the shaft, in the order the pen met them.
fn arrow_barbs(
    head: &[SnapPoint],
    base: SnapPoint,
    tip: SnapPoint,
) -> Option<(SnapPoint, SnapPoint)> {
    let (to_x, to_y) = (tip[0] - base[0], tip[1] - base[1]);
    let length = hypot(to_x, to_y);
    if length <= 0.0 {
        return None;
    }
    let (nx, ny) = (-to_y / length, to_x / length);
    let mut widest: Option<usize> = None;
    let mut widest_offset = 0.0;
    let mut second: Option<usize> = None;
    let mut second_offset = 0.0;
    for (i, &[x, y]) in head.iter().enumerate() {
        let offset = (x - base[0]) * nx + (y - base[1]) * ny;
        let magnitude = offset.abs();
        if magnitude > widest_offset {
            second = widest;
            second_offset = widest_offset;
            widest = Some(i);
            widest_offset = magnitude;
        } else if magnitude > second_offset {
            second = Some(i);
            second_offset = magnitude;
        }
    }
    let (w, s) = (widest?, second?);
    let first_barb = *head.get(w.min(s))?;
    let second_barb = *head.get(w.max(s))?;
    Some((first_barb, second_barb))
}

fn opening_degrees(tip: SnapPoint, a: SnapPoint, b: SnapPoint) -> f64 {
    let (ax, ay) = (a[0] - tip[0], a[1] - tip[1]);
    let (bx, by) = (b[0] - tip[0], b[1] - tip[1]);
    let (la, lb) = (hypot(ax, ay), hypot(bx, by));
    if la <= 0.0 || lb <= 0.0 {
        return 0.0;
    }
    let cosine = max(-1.0, min(1.0, (ax * bx + ay * by) / (la * lb)));
    (cosine.acos() * 180.0) / PI
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line_of(fit: Option<ShapeFit>) -> Option<LineGeometry> {
        match fit?.geometry {
            SnapGeometry::Line(line) => Some(line),
            _ => None,
        }
    }

    /// Closed square of side 100, walked in 10-unit steps with ±1 jitter.
    fn jittered_square() -> Vec<f64> {
        let corners = [[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]];
        let mut path = Vec::new();
        for (edge, a) in corners.iter().enumerate() {
            let b = corners[(edge + 1) % 4];
            let (dx, dy) = ((b[0] - a[0]) / 100.0, (b[1] - a[1]) / 100.0);
            for k in 0..10 {
                let t = k as f64 * 10.0;
                let j = (k % 3) as f64 - 1.0;
                path.push(a[0] + dx * t + j);
                path.push(a[1] + dy * t + j);
            }
        }
        let (fx, fy) = (path[0], path[1]);
        path.push(fx);
        path.push(fy);
        path
    }

    /// Circle of radius 100 at (200, 300), 40 samples, closed.
    fn circle40() -> Vec<f64> {
        let mut path = Vec::new();
        for i in 0..=40 {
            let angle = f64::from(i) / 40.0 * std::f64::consts::TAU;
            path.push(200.0 + 100.0 * angle.cos());
            path.push(300.0 + 100.0 * angle.sin());
        }
        path
    }

    /// Shaft from (0,0) to (200,0), then two barbs doubling back to (90, ±30).
    fn arrow_path() -> Vec<f64> {
        let mut path = Vec::new();
        for i in 0..=20 {
            path.push(f64::from(i) * 10.0);
            path.push(0.0);
        }
        path.extend([90.0, 30.0, 90.0, -30.0]);
        path
    }

    /// Deterministic uniform scatter over a 300-unit box.
    fn scribble() -> Vec<f64> {
        let mut seed: u64 = 12_345;
        let mut path = Vec::new();
        for _ in 0..120 {
            seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            path.push(((seed >> 33) % 300) as f64);
        }
        path
    }

    #[test]
    fn wobbly_line_snaps_with_endpoints_kept() {
        let path = [0.0, 0.0, 50.0, 2.0, 100.0, -1.0, 150.0, 1.0, 200.0, 0.0];
        let line = line_of(fit_line(&path)).expect("line fit");
        assert!(line.start[0].abs() <= 2.0 && line.start[1].abs() <= 2.0);
        assert!((line.end[0] - 200.0).abs() <= 2.0 && line.end[1].abs() <= 2.0);
        assert!((line.length - 200.0).abs() <= 2.0);
        assert!(snap_ink_shape(&path).is_some_and(|s| s.shape == InkShape::Line));
    }

    #[test]
    fn jittered_square_snaps_to_rect() {
        assert!(snap_ink_shape(&jittered_square()).is_some_and(|s| s.shape == InkShape::Rect));
    }

    #[test]
    fn circle_snaps_to_ellipse() {
        assert!(snap_ink_shape(&circle40()).is_some_and(|s| s.shape == InkShape::Ellipse));
    }

    #[test]
    fn shaft_with_doubling_head_snaps_to_arrow() {
        assert!(snap_ink_shape(&arrow_path()).is_some_and(|s| s.shape == InkShape::Arrow));
    }

    #[test]
    fn scribble_abstains() {
        assert!(snap_ink_shape(&scribble()).is_none());
    }

    #[test]
    fn too_few_points_or_tiny_span_abstain() {
        assert!(snap_ink_shape(&[10.0, 10.0]).is_none());
        let tiny = [0.0, 0.0, 10.0, 0.0, 20.0, 5.0, 30.0, 0.0, 40.0, 0.0];
        assert!(snap_ink_shape(&tiny).is_none());
    }

    #[test]
    fn resample_keeps_endpoints_and_spaces_samples() {
        let path = [0.0, 0.0, 1.0, 0.0, 2.0, 0.0, 3.0, 0.0, 10.0, 0.0];
        assert_eq!(
            resample_path(&path),
            vec![[0.0, 0.0], [2.0, 0.0], [10.0, 0.0]]
        );
    }

    #[test]
    fn path_length_and_bounds_basics() {
        assert_eq!(path_length(&[[0.0, 0.0], [3.0, 4.0], [3.0, 0.0]]), 9.0);
        let bounds = snap_bounds(&[[1.0, 2.0], [5.0, -3.0]]);
        assert_eq!(
            bounds,
            Some(SnapBounds {
                min_x: 1.0,
                min_y: -3.0,
                max_x: 5.0,
                max_y: 2.0,
            })
        );
        assert_eq!(snap_bounds(&[]), None);
    }

    #[test]
    fn snap_points_rounds_and_drops_bad_pairs() {
        assert_eq!(
            snap_points(&[0.4, 1.6, f64::NAN, 2.0, 3.0]),
            vec![[0.0, 2.0]]
        );
    }

    #[test]
    fn confidence_of_edges() {
        assert_eq!(confidence_of(0.0, 0.04), 1.0);
        assert_eq!(confidence_of(0.04, 0.04), 0.0);
        assert_eq!(confidence_of(0.1, 0.04), 0.0);
        assert_eq!(confidence_of(0.02, 0.0), 0.0);
        assert_eq!(confidence_of(0.02, 0.04), 0.5);
    }
}
