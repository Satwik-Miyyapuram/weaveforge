//! Packing a stroke for storage while it is written: points are only appended.
//! Port of `stroke-packer.ts`.

use serde::{Deserialize, Serialize};

use super::curve::ink_curve_at;
use super::js_math;
use super::{
    INK_COORD_LIMIT, INK_PACK_PRESSURE_TOLERANCE, INK_PACK_TOLERANCE, INK_STROKE_MAX_POINTS,
    PackedInkStroke, pressure_byte,
};

/// Storage-ready form of one captured stroke, pressure included.
///
/// The whole stroke pushed through an [`InkStrokePacker`], so a stroke packed
/// at once is exactly the one the pen drew live. Fewer than two finite samples
/// is nothing to draw and packs to nothing; pressure of the wrong length is
/// ignored rather than misaligned.
#[must_use]
pub fn pack_ink_stroke(
    points: &[f64],
    pressures: &[f64],
    options: InkStrokePackerOptions,
) -> PackedInkStroke {
    let even = &points[..(points.len() / 2) * 2];
    if even.len() < 4 || even.iter().any(|v| !v.is_finite()) {
        return PackedInkStroke::default();
    }
    let use_pressures = pressures.len() == even.len() / 2;
    let mut packer = InkStrokePacker::new(options);
    for i in 0..even.len() / 2 {
        let pressure = if use_pressures {
            pressures.get(i).copied()
        } else {
            None
        };
        packer.push(even[i * 2], even[i * 2 + 1], pressure);
    }
    packer.packed()
}

/// Options for [`InkStrokePacker`] and [`pack_ink_stroke`]; a missing field takes the default.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkStrokePackerOptions {
    /// Distance, in 0.1 mm, the packed curve may stray; default `INK_PACK_TOLERANCE`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub tolerance: Option<f64>,
    /// Most points a stroke keeps; default `INK_STROKE_MAX_POINTS`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub max_points: Option<f64>,
    /// Pressure deviation, out of 255, that keeps a point; default `INK_PACK_PRESSURE_TOLERANCE`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub pressure_tolerance: Option<f64>,
}

/// Chords a span is cut into when a sample is measured against its curve.
const PACK_SPAN_STEPS: usize = 16;

/// Packs a stroke while it is written, keeping points only ever appended.
///
/// Xournal++, tldraw and Excalidraw all add points as the pen moves and never
/// revisit them. This does the same with fewer points: a sleeve in the manner
/// of Lang's simplification (1969) grows from the last kept sample, and the
/// samples inside it are measured against the curve that is drawn, with the
/// error bound of Schneider's curve fitting ("An Algorithm for Automatically
/// Fitting Digitized Curves", Graphics Gems, 1990), and pressure held to a
/// straight ramp within `pressure_tolerance`.
///
/// When a new sample no longer fits, one sample of the run is kept: the one
/// whose two spans fit with the least error. No kept point is ever moved. At
/// `max_points` the packer stops keeping points and the stroke's end follows
/// the pen.
pub struct InkStrokePacker {
    tolerance: f64,
    max_points: f64,
    pressure_tolerance: f64,
    xs: Vec<f64>,
    ys: Vec<f64>,
    ps: Vec<f64>,
    kept: Vec<usize>,
    curve_x: [f64; PACK_SPAN_STEPS + 1],
    curve_y: [f64; PACK_SPAN_STEPS + 1],
}

/// `span` and `at` are -1 for none, as in the TS copy.
struct Miss {
    span: isize,
    at: isize,
    error: f64,
}

struct Worst {
    at: isize,
    distance: f64,
}

fn clamp_coord(v: f64) -> f64 {
    js_math::max(
        -INK_COORD_LIMIT,
        js_math::min(INK_COORD_LIMIT, js_math::round(v)),
    )
}

impl InkStrokePacker {
    /// A packer with `options`; a missing option takes its default.
    #[must_use]
    pub fn new(options: InkStrokePackerOptions) -> Self {
        Self {
            tolerance: options.tolerance.unwrap_or(INK_PACK_TOLERANCE),
            max_points: js_math::max(2.0, options.max_points.unwrap_or(INK_STROKE_MAX_POINTS)),
            pressure_tolerance: options
                .pressure_tolerance
                .unwrap_or(INK_PACK_PRESSURE_TOLERANCE),
            xs: Vec::new(),
            ys: Vec::new(),
            ps: Vec::new(),
            kept: Vec::new(),
            curve_x: [0.0; PACK_SPAN_STEPS + 1],
            curve_y: [0.0; PACK_SPAN_STEPS + 1],
        }
    }

    /// Add the pen's next sample, in 0.1 mm, with its 0–255 pressure if it has one.
    /// A non-finite one is skipped.
    pub fn push(&mut self, x: f64, y: f64, pressure: Option<f64>) {
        if !x.is_finite() || !y.is_finite() {
            return;
        }
        let c = self.xs.len();
        self.xs.push(clamp_coord(x));
        self.ys.push(clamp_coord(y));
        self.ps.push(pressure_byte(pressure));
        if c == 0 {
            self.kept.push(0);
        } else if (self.kept.len() as f64) < self.max_points - 1.0 {
            self.advance(c);
        }
    }

    /// The stroke so far: every kept point, then the pen's latest sample.
    #[must_use]
    pub fn packed(&self) -> PackedInkStroke {
        let n = self.xs.len();
        let mut indices = self.kept.clone();
        if n > 1 {
            indices.push(n - 1);
        }
        PackedInkStroke {
            points: indices
                .iter()
                .flat_map(|&i| [self.xs[i], self.ys[i]])
                .collect(),
            pressures: indices.iter().map(|&i| self.ps[i]).collect(),
        }
    }

    fn advance(&mut self, c: usize) {
        let a = self.kept.last().copied().unwrap_or(0);
        // The last three kept points: the span behind the pen and its tangent.
        let tail: Vec<usize> = self.kept[self.kept.len().saturating_sub(3)..].to_vec();
        let first = tail.len().saturating_sub(2);
        let mut with_pen = tail.clone();
        with_pen.push(c);
        if self.first_miss(&with_pen, first).span < 0 {
            return;
        }

        // Keep the sample whose spans fit best. Scanning back from the pen, the
        // span to the pen only grows, so the first one that misses ends the scan.
        let mut best: isize = -1;
        let mut best_error = f64::INFINITY;
        let mut j = c - 1;
        while j > a {
            let mut ids = tail.clone();
            ids.extend([j, c]);
            if self.worst_in(&ids, ids.len() - 2).at >= 0 {
                break;
            }
            let fit = self.first_miss(&ids, first);
            if fit.span < 0 && fit.error < best_error {
                best = j as isize;
                best_error = fit.error;
            }
            j -= 1;
        }
        if best >= 0 {
            self.kept.push(best as usize);
            return;
        }

        // No single sample fits, which happens at a sharp corner. Split at the
        // worst sample until every span fits. When the span behind the pen is the
        // one off, keeping the sample just past the corner makes the next chord
        // short, so the tangent follows the edge it closes and the corner stays sharp.
        let mut ids = tail.clone();
        ids.push(c);
        loop {
            let miss = self.first_miss(&ids, first);
            if miss.span < 0 {
                break;
            }
            if miss.at < a as isize {
                let next = a + 1;
                if next >= c || ids.contains(&next) {
                    break;
                }
                let pos = ids.iter().position(|&v| v == a).map_or(0, |p| p + 1);
                ids.insert(pos, next);
            } else {
                ids.insert(miss.span as usize + 1, miss.at as usize);
            }
        }
        let room = self.max_points - 1.0 - self.kept.len() as f64;
        let take = if room > 0.0 { room.trunc() as usize } else { 0 };
        let picked: Vec<usize> = ids[tail.len()..ids.len() - 1]
            .iter()
            .copied()
            .take(take)
            .collect();
        self.kept.extend(picked);
    }

    /// The first span from `first` on with a sample out of tolerance, and the worst error of those that fit.
    fn first_miss(&mut self, ids: &[usize], first: usize) -> Miss {
        let mut error = 0.0;
        let mut s = first;
        while s + 1 < ids.len() {
            let worst = self.worst_in(ids, s);
            if worst.at >= 0 {
                return Miss {
                    span: s as isize,
                    at: worst.at,
                    error,
                };
            }
            error = js_math::max(error, worst.distance);
            s += 1;
        }
        Miss {
            span: -1,
            at: -1,
            error,
        }
    }

    /// Span `s` of the curve through the samples `ids`: the sample inside it
    /// farthest off the curve when that is past the tolerance (else the one
    /// whose pressure leaves the ramp most), and the farthest squared distance.
    fn worst_in(&mut self, ids: &[usize], s: usize) -> Worst {
        let from = ids[s] as isize;
        let to = ids[s + 1] as isize;
        if to - from < 2 {
            return Worst {
                at: -1,
                distance: 0.0,
            };
        }
        let xs: Vec<f64> = ids.iter().map(|&i| self.xs[i]).collect();
        let ys: Vec<f64> = ids.iter().map(|&i| self.ys[i]).collect();
        for k in 0..=PACK_SPAN_STEPS {
            let p = ink_curve_at(&xs, &ys, s, k as f64 / PACK_SPAN_STEPS as f64);
            self.curve_x[k] = p.0;
            self.curve_y[k] = p.1;
        }
        let limit = self.tolerance * self.tolerance;
        let mut at: isize = -1;
        let mut distance: f64 = 0.0;
        for j in (from + 1)..to {
            let j_idx = j as usize;
            let (px, py) = (self.xs[j_idx], self.ys[j_idx]);
            let mut best = f64::INFINITY;
            for k in 0..PACK_SPAN_STEPS {
                let (ax, ay) = (self.curve_x[k], self.curve_y[k]);
                let vx = self.curve_x[k + 1] - ax;
                let vy = self.curve_y[k + 1] - ay;
                let length = vx * vx + vy * vy;
                let u = if length > 0.0 {
                    js_math::max(
                        0.0,
                        js_math::min(1.0, ((px - ax) * vx + (py - ay) * vy) / length),
                    )
                } else {
                    0.0
                };
                let dx = ax + u * vx - px;
                let dy = ay + u * vy - py;
                best = js_math::min(best, dx * dx + dy * dy);
            }
            if best > distance {
                if best > limit {
                    at = j;
                }
                distance = best;
            }
        }
        if at >= 0 {
            return Worst { at, distance };
        }
        let mut far = self.pressure_tolerance;
        let (pf, pt) = (self.ps[from as usize], self.ps[to as usize]);
        for j in (from + 1)..to {
            let t = (j - from) as f64 / (to - from) as f64;
            let off = (self.ps[j as usize] - (pf + (pt - pf) * t)).abs();
            if off > far {
                far = off;
                at = j;
            }
        }
        Worst { at, distance }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    /// Strokes in the model's unit, 0.1 mm. A pen reports at 240 Hz, so a stroke
    /// written at v mm/s leaves a sample every (v / 240) * 10 units.
    fn step_at(speed: f64) -> f64 {
        (speed / 240.0) * 10.0
    }

    fn pack(raw: &[f64]) -> PackedInkStroke {
        pack_ink_stroke(raw, &[], InkStrokePackerOptions::default())
    }

    fn split_xy(points: &[f64]) -> (Vec<f64>, Vec<f64>) {
        (
            points.iter().step_by(2).copied().collect(),
            points.iter().skip(1).step_by(2).copied().collect(),
        )
    }

    fn head(v: &[f64], n: usize) -> &[f64] {
        &v[..n.min(v.len())]
    }

    /// A rectangle traced corner to corner, `wobble` units of hand shake on it.
    fn box_points(w: f64, h: f64, step: f64, wobble: f64) -> Vec<f64> {
        let corners = [
            [100.0, 500.0],
            [100.0 + w, 500.0],
            [100.0 + w, 500.0 + h],
            [100.0, 500.0 + h],
            [100.0, 500.0],
        ];
        let mut points = Vec::new();
        for e in 0..4 {
            let [ax, ay] = corners[e];
            let [bx, by] = corners[e + 1];
            let length = js_math::hypot(bx - ax, by - ay);
            let n = js_math::max(1.0, js_math::round(length / step)) as usize;
            for k in 0..n {
                let t = k as f64 / n as f64;
                let s = e as f64 * length + k as f64 * step;
                points.push(ax + (bx - ax) * t + wobble * (0.07 * s + e as f64).sin());
                points.push(ay + (by - ay) * t + wobble * (0.05 * s + 2.0 * e as f64).cos());
            }
        }
        points.extend([100.0, 500.0]);
        points
    }

    fn loop_point(r: f64, t: f64) -> (f64, f64) {
        (
            1000.0 + 0.4 * r * t + r * t.sin(),
            1000.0 + 1.6 * r * t.cos(),
        )
    }

    /// Cursive loops of radius `r` drifting right, sampled every `step` units of arc.
    fn loops_points(r: f64, step: f64, turns: f64) -> Vec<f64> {
        let (mut px, mut py) = loop_point(r, 0.0);
        let mut points = vec![px, py];
        let mut run = 0.0;
        let mut t = 0.0005;
        while t <= turns * 2.0 * PI {
            let (qx, qy) = loop_point(r, t);
            run += js_math::hypot(qx - px, qy - py);
            px = qx;
            py = qy;
            if run >= step {
                points.extend([qx, qy]);
                run = 0.0;
            }
            t += 0.0005;
        }
        points
    }

    /// Distance from a point to the drawn curve of one span, the span cut into 32 chords.
    fn span_distance(xs: &[f64], ys: &[f64], span: usize, px: f64, py: f64) -> f64 {
        let mut best = f64::INFINITY;
        let mut a = ink_curve_at(xs, ys, span, 0.0);
        for k in 1..=32 {
            let b = ink_curve_at(xs, ys, span, k as f64 / 32.0);
            let (vx, vy) = (b.0 - a.0, b.1 - a.1);
            let length = vx * vx + vy * vy;
            let u = if length > 0.0 {
                js_math::max(
                    0.0,
                    js_math::min(1.0, ((px - a.0) * vx + (py - a.1) * vy) / length),
                )
            } else {
                0.0
            };
            best = js_math::min(best, js_math::hypot(a.0 + u * vx - px, a.1 + u * vy - py));
            a = b;
        }
        best
    }

    /// How far the curve drawn through `packed` strays from the pen's samples: each
    /// rounded sample, against the span it fell in. Packed points are a subset of
    /// the rounded samples in order, which is what lets a sample find its span.
    fn worst_sample_distance(raw: &[f64], packed: &[f64]) -> f64 {
        let rounded: Vec<f64> = raw.iter().map(|&v| js_math::round(v)).collect();
        let (xs, ys) = split_xy(packed);
        let n = xs.len();
        let mut worst = 0.0;
        let mut span = 0;
        for j in 1..rounded.len() / 2 {
            let (x, y) = (rounded[2 * j], rounded[2 * j + 1]);
            if span + 2 < n && x == xs[span + 1] && y == ys[span + 1] {
                span += 1;
                continue;
            }
            worst = js_math::max(worst, span_distance(&xs, &ys, span, x, y));
        }
        worst
    }

    /// A press that swells and fades along the stroke, the way a written word does.
    fn taper(n: usize) -> Vec<f64> {
        (0..n)
            .map(|i| js_math::round(120.0 + 100.0 * ((i as f64 / n as f64) * PI * 3.0).sin()))
            .collect()
    }

    /// Each frame of a stroke as the pen writes it: what the packer holds after every sample.
    fn frames(raw: &[f64], pressures: &[f64]) -> Vec<PackedInkStroke> {
        let mut packer = InkStrokePacker::new(InkStrokePackerOptions::default());
        (0..raw.len() / 2)
            .map(|i| {
                packer.push(raw[2 * i], raw[2 * i + 1], pressures.get(i).copied());
                packer.packed()
            })
            .collect()
    }

    fn curve_of(points: &[f64], spans: usize) -> Vec<f64> {
        let (xs, ys) = split_xy(points);
        let mut out = Vec::new();
        for s in 0..spans {
            for k in 0..=8 {
                let p = ink_curve_at(&xs, &ys, s, k as f64 / 8.0);
                out.push(p.0);
                out.push(p.1);
            }
        }
        out
    }

    fn written() -> Vec<(String, Vec<f64>)> {
        vec![
            (
                "loops r5 50mm/s".into(),
                loops_points(5.0, step_at(50.0), 2.0),
            ),
            (
                "loops r8 150mm/s".into(),
                loops_points(8.0, step_at(150.0), 2.0),
            ),
            (
                "loops r12 20mm/s".into(),
                loops_points(12.0, step_at(20.0), 5.0),
            ),
            (
                "box 50x30 300mm/s wobble 1".into(),
                box_points(50.0, 30.0, step_at(300.0), 1.0),
            ),
            (
                "box 200x150 50mm/s wobble 3".into(),
                box_points(200.0, 150.0, step_at(50.0), 3.0),
            ),
        ]
    }

    #[test]
    fn the_curve_drawn_through_a_packed_stroke_stays_within_the_pack_tolerance() {
        let mut cases: Vec<(String, Vec<f64>)> = Vec::new();
        for (w, h) in [(200.0, 150.0), (50.0, 30.0), (20.0, 20.0)] {
            for speed in [50.0, 150.0, 300.0] {
                for wobble in [0.0, 1.0, 3.0] {
                    cases.push((
                        format!("box {w}x{h} {speed}mm/s wobble {wobble}"),
                        box_points(w, h, step_at(speed), wobble),
                    ));
                }
            }
        }
        for (r, speed) in [(5.0, 50.0), (12.0, 150.0), (50.0, 50.0), (100.0, 50.0)] {
            cases.push((
                format!("loops r{r} {speed}mm/s"),
                loops_points(r, step_at(speed), 2.0),
            ));
        }
        for (name, raw) in cases {
            let packed = pack(&raw).points;
            let worst = worst_sample_distance(&raw, &packed);
            // The bound is checked against 32 chords a span, so allow their sagitta.
            assert!(
                worst <= INK_PACK_TOLERANCE + 0.05,
                "{name}: a sample is {worst:.2} units off the curve"
            );
        }
    }

    #[test]
    fn a_clean_box_is_drawn_as_a_box() {
        // Between two samples at a corner the curve still rounds the turn, so the
        // bound is twice the tolerance. A box kept as its corners bows 3 mm.
        let bound = 2.0 * INK_PACK_TOLERANCE;
        let cases = [
            (200.0, 150.0, 50.0),
            (200.0, 150.0, 150.0),
            (200.0, 150.0, 300.0),
            (50.0, 30.0, 150.0),
            (50.0, 30.0, 300.0),
            (20.0, 20.0, 150.0),
            (20.0, 20.0, 300.0),
        ];
        for (w, h, speed) in cases {
            let packed = pack(&box_points(w, h, step_at(speed), 0.0)).points;
            let (xs, ys) = split_xy(&packed);
            let mut out: f64 = 0.0;
            for i in 0..xs.len().saturating_sub(1) {
                for k in 0..=64 {
                    let p = ink_curve_at(&xs, &ys, i, k as f64 / 64.0);
                    let edge = js_math::max(
                        js_math::max(100.0 - p.0, p.0 - (100.0 + w)),
                        js_math::max(500.0 - p.1, p.1 - (500.0 + h)),
                    );
                    out = js_math::max(out, edge);
                }
            }
            assert!(
                out <= bound,
                "{w}x{h} at {speed} mm/s: the curve bows {out:.2} units past an edge"
            );
        }
    }

    #[test]
    fn packing_as_the_pen_writes_gives_the_same_stroke_as_packing_it_whole() {
        for (name, raw) in written() {
            let pressures = taper(raw.len() / 2);
            let whole = pack_ink_stroke(&raw, &pressures, InkStrokePackerOptions::default());
            let live = frames(&raw, &pressures);
            assert_eq!(live.last(), Some(&whole), "{name}");
            let live_plain = frames(&raw, &[]);
            assert_eq!(live_plain.last(), Some(&pack(&raw)), "{name}, no pressure");
        }
    }

    #[test]
    fn a_point_once_kept_never_moves_every_frame_extends_the_one_before() {
        // Only the pen's own sample, the last point, is replaced by the next frame.
        for (name, raw) in written() {
            let all = frames(&raw, &taper(raw.len() / 2));
            for k in 1..all.len() {
                let (before, after) = (&all[k - 1], &all[k]);
                let bp = before.points.len() - 2;
                let bq = before.pressures.len() - 1;
                assert_eq!(
                    head(&after.points, bp),
                    head(&before.points, bp),
                    "{name}, frame {k}"
                );
                assert_eq!(
                    head(&after.pressures, bq),
                    head(&before.pressures, bq),
                    "{name}, frame {k}"
                );
            }
        }
    }

    #[test]
    fn ink_behind_the_pen_is_drawn_the_same_in_every_later_frame() {
        // A span's curve reads the point after its end, so the last two spans may
        // still turn; everything before them is final the moment it is drawn.
        for (name, raw) in written() {
            let all = frames(&raw, &[]);
            let last = all.last().map(|f| f.points.clone()).unwrap_or_default();
            for (k, frame) in all.iter().enumerate() {
                let count = frame.points.len() / 2;
                if count > 3 {
                    let spans = count - 3;
                    assert_eq!(
                        curve_of(&frame.points, spans),
                        curve_of(&last, spans),
                        "{name}, frame {k}"
                    );
                }
            }
        }
    }

    #[test]
    fn a_pen_held_still_or_tapped_packs_to_finite_points() {
        assert_eq!(
            pack(&[50.0, 60.0, 50.0, 60.0]).points,
            vec![50.0, 60.0, 50.0, 60.0]
        );
        let mut still = Vec::new();
        for _ in 0..30 {
            still.extend([200.0, 200.0]);
        }
        for i in 0..30 {
            still.extend([200.0 + i as f64 * 4.0, 200.0 + (i % 3) as f64]);
        }
        let pressures = taper(still.len() / 2);
        let packed = pack_ink_stroke(&still, &pressures, InkStrokePackerOptions::default()).points;
        assert!(packed.len() >= 4);
        assert!(packed.iter().all(|v| v.is_finite()));
        let n = packed.len();
        assert_eq!(&packed[n - 2..], &still[still.len() - 2..]);
    }

    #[test]
    fn a_stroke_shorter_than_two_samples_packs_to_nothing_one_sample_to_itself() {
        let mut packer = InkStrokePacker::new(InkStrokePackerOptions::default());
        assert_eq!(packer.packed(), PackedInkStroke::default());
        packer.push(10.4, 20.6, Some(300.0));
        assert_eq!(
            packer.packed(),
            PackedInkStroke {
                points: vec![10.0, 21.0],
                pressures: vec![255.0],
            }
        );
    }

    #[test]
    fn a_sample_that_is_not_a_number_is_skipped_so_the_stroke_stays_drawable() {
        let mut packer = InkStrokePacker::new(InkStrokePackerOptions::default());
        packer.push(0.0, 0.0, Some(128.0));
        packer.push(f64::NAN, 5.0, Some(128.0));
        packer.push(30.0, f64::INFINITY, Some(128.0));
        packer.push(30.0, 0.0, Some(128.0));
        assert_eq!(
            packer.packed(),
            PackedInkStroke {
                points: vec![0.0, 0.0, 30.0, 0.0],
                pressures: vec![128.0, 128.0],
            }
        );
    }

    #[test]
    fn a_straight_line_is_still_its_two_ends() {
        let mut raw = Vec::new();
        for i in 0..=100 {
            raw.extend([10.0 + i as f64 * 3.0, 40.0]);
        }
        assert_eq!(pack(&raw).points, vec![10.0, 40.0, 310.0, 40.0]);
    }

    #[test]
    fn the_curve_pass_never_pushes_a_stroke_past_the_point_cap() {
        // A wobbly box drawn round and round: every corner wants points back.
        let mut raw = Vec::new();
        for _ in 0..60 {
            raw.extend(box_points(200.0, 150.0, step_at(50.0), 1.0));
        }
        let options = InkStrokePackerOptions {
            max_points: Some(200.0),
            ..Default::default()
        };
        let packed = pack_ink_stroke(&raw, &[], options).points;
        assert!(packed.len() / 2 <= 200, "{} points", packed.len() / 2);
        let end: Vec<f64> = raw[raw.len() - 2..]
            .iter()
            .map(|&v| js_math::round(v))
            .collect();
        let n = packed.len();
        assert_eq!(&packed[n - 2..], &end[..], "and the true end is kept");
    }

    #[test]
    fn packed_points_are_always_samples_of_the_stroke_in_order() {
        let raw = box_points(50.0, 30.0, step_at(150.0), 1.0);
        let rounded: Vec<f64> = raw.iter().map(|&v| js_math::round(v)).collect();
        let packed = pack(&raw).points;
        let mut j = 0;
        for i in 0..packed.len() / 2 {
            while j < rounded.len() / 2
                && (rounded[2 * j] != packed[2 * i] || rounded[2 * j + 1] != packed[2 * i + 1])
            {
                j += 1;
            }
            assert!(j < rounded.len() / 2, "point {i} is a sample");
            j += 1;
        }
    }
}
