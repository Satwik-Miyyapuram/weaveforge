//! Handwriting on a canvas: free strokes kept in the `wfInk` field of the `.canvas` file. JSON
//! Canvas allows extra top-level fields, so Obsidian is expected to ignore this one; whether it
//! keeps the field when Obsidian itself saves the canvas is not verified. WeaveForge keeps it
//! through its own read and write.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::Canvas;
use super::geometry::CanvasRect;

/// Top-level field of the canvas file that holds the strokes.
pub const INK_FIELD: &str = "wfInk";

/// One pen or highlighter stroke, in canvas pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FreeStroke {
    /// Unique id within the canvas.
    pub id: String,
    /// Origin in page px.
    #[serde(serialize_with = "super::whole")]
    pub x: f64,
    /// Origin in page px.
    #[serde(serialize_with = "super::whole")]
    pub y: f64,
    /// Width in px.
    #[serde(serialize_with = "super::whole")]
    pub w: f64,
    /// Colour, hex like "#1f2937".
    pub c: String,
    /// Tool: "pen" or "highlighter".
    #[serde(default = "pen")]
    pub t: String,
    /// Points as flat [dx0,dy0,dx1,dy1,...] integer offsets in 0.1 px from (x,y).
    pub p: Vec<i32>,
    /// Pressure per point 0-255; empty = constant.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub r: Vec<u8>,
    /// Fields this version does not know, kept for the round trip.
    #[serde(flatten)]
    #[cfg_attr(feature = "specta", specta(skip))]
    pub extra: Map<String, Value>,
}

fn pen() -> String {
    "pen".to_owned()
}

/// The strokes on a canvas. A missing or non-array field reads as none; invalid items are
/// skipped so one bad stroke does not hide the rest.
#[must_use]
pub fn read_ink(canvas: &Canvas) -> Vec<FreeStroke> {
    let Some(Value::Array(items)) = canvas.extra.get(INK_FIELD) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| FreeStroke::deserialize(item).ok())
        .collect()
}

/// Replaces the strokes on a canvas. No strokes removes the field, so an ink-free canvas is
/// written exactly as before. A stroke whose origin or width is not a finite number is left
/// out, as JSON has no way to write it.
pub fn write_ink(canvas: &mut Canvas, strokes: &[FreeStroke]) {
    let items: Vec<Value> = strokes
        .iter()
        .filter(|s| s.x.is_finite() && s.y.is_finite() && s.w.is_finite())
        .filter_map(|stroke| serde_json::to_value(stroke).ok())
        .collect();
    if items.is_empty() {
        let _ = canvas.extra.remove(INK_FIELD);
        return;
    }
    let _ = canvas
        .extra
        .insert(INK_FIELD.to_owned(), Value::Array(items));
}

/// The box around a stroke's points, grown by half its width. `None` for a stroke with no
/// points or an unpaired coordinate.
#[must_use]
pub fn stroke_rect(s: &FreeStroke) -> Option<CanvasRect> {
    let points = absolute_points(s)?;
    let (first, rest) = points.split_first()?;
    let (mut left, mut top) = *first;
    let (mut right, mut bottom) = *first;
    for &(x, y) in rest {
        left = left.min(x);
        top = top.min(y);
        right = right.max(x);
        bottom = bottom.max(y);
    }
    let half = s.w.max(0.0) / 2.0;
    Some(CanvasRect {
        x: left - half,
        y: top - half,
        width: right - left + 2.0 * half,
        height: bottom - top + 2.0 * half,
    })
}

/// Ids of the strokes with any part within `radius` of (`x`, `y`), counting half the stroke
/// width, so a stroke is hit where it is drawn and not only on its centre line.
#[must_use]
pub fn strokes_hit(strokes: &[FreeStroke], x: f64, y: f64, radius: f64) -> Vec<String> {
    strokes
        .iter()
        .filter(|s| {
            let Some(points) = absolute_points(s) else {
                return false;
            };
            let reach = radius + s.w.max(0.0) / 2.0;
            distance_to_points(&points, x, y) <= reach
        })
        .map(|s| s.id.clone())
        .collect()
}

/// The points in canvas pixels. `None` when there are none or a coordinate is unpaired.
fn absolute_points(s: &FreeStroke) -> Option<Vec<(f64, f64)>> {
    if s.p.is_empty() || s.p.len() % 2 == 1 {
        return None;
    }
    Some(
        s.p.as_chunks::<2>()
            .0
            .iter()
            .map(|&[dx, dy]| (s.x + f64::from(dx) / 10.0, s.y + f64::from(dy) / 10.0))
            .collect(),
    )
}

/// Distance from (`x`, `y`) to the polyline; a single point is its dot.
fn distance_to_points(points: &[(f64, f64)], x: f64, y: f64) -> f64 {
    match points {
        [only] => (x - only.0).hypot(y - only.1),
        _ => points
            .windows(2)
            .map(|w| segment_distance(x, y, w[0], w[1]))
            .fold(f64::INFINITY, f64::min),
    }
}

/// Distance from (`x`, `y`) to the segment `a`-`b`.
fn segment_distance(x: f64, y: f64, a: (f64, f64), b: (f64, f64)) -> f64 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 {
        0.0
    } else {
        (((x - a.0) * dx + (y - a.1) * dy) / len2).clamp(0.0, 1.0)
    };
    (x - (a.0 + t * dx)).hypot(y - (a.1 + t * dy))
}

#[cfg(test)]
mod tests {
    use super::super::{canvas_text, normalize_canvas_text, parse_canvas};
    use super::*;
    use serde_json::json;

    fn stroke(id: &str, x: f64, y: f64, w: f64, p: Vec<i32>) -> FreeStroke {
        FreeStroke {
            id: id.into(),
            x,
            y,
            w,
            c: "#1f2937".into(),
            t: pen(),
            p,
            r: Vec::new(),
            extra: Map::new(),
        }
    }

    #[test]
    fn strokes_round_trip_through_the_canvas_text() {
        let mut canvas = Canvas::default();
        let strokes = vec![
            stroke("a", 1.0, 2.0, 3.0, vec![0, 0, 10, 5]),
            FreeStroke {
                t: "highlighter".into(),
                r: vec![1, 255],
                ..stroke("b", 4.0, 5.0, 2.0, vec![0, 0])
            },
        ];
        write_ink(&mut canvas, &strokes);
        assert_eq!(read_ink(&canvas), strokes);
        let again = parse_canvas(&canvas_text(&canvas)).unwrap();
        assert_eq!(read_ink(&again), strokes);
    }

    #[test]
    fn missing_field_reads_as_no_strokes_and_no_strokes_removes_it() {
        let mut canvas = Canvas::default();
        assert!(read_ink(&canvas).is_empty());
        write_ink(&mut canvas, &[stroke("a", 0.0, 0.0, 1.0, vec![0, 0])]);
        assert!(canvas.extra.contains_key(INK_FIELD));
        write_ink(&mut canvas, &[]);
        assert!(!canvas.extra.contains_key(INK_FIELD));
    }

    #[test]
    fn whole_origins_and_widths_are_written_without_a_fraction() {
        let mut canvas = Canvas::default();
        let strokes = [
            stroke("a", 100.0, -20.0, 2.0, vec![0, 0]),
            stroke("b", 0.5, -0.25, 1.5, vec![0, 0]),
        ];
        write_ink(&mut canvas, &strokes);
        let text = canvas_text(&canvas);
        assert!(
            text.contains(r#"{"id":"a","x":100,"y":-20,"w":2,"#),
            "{text}"
        );
        assert!(
            text.contains(r#"{"id":"b","x":0.5,"y":-0.25,"w":1.5,"#),
            "{text}"
        );
        // The editor saves the normalized form; a written canvas must already be in it.
        assert_eq!(normalize_canvas_text(&text).unwrap(), text);
    }

    #[test]
    fn invalid_items_are_skipped_and_valid_ones_kept() {
        let mut canvas = Canvas::default();
        let _ = canvas.extra.insert(
            INK_FIELD.into(),
            json!([
                {"id": "ok", "x": 0, "y": 0, "w": 2, "c": "#000000", "p": [0, 0]},
                {"id": "no-points"},
                "junk",
                7,
                {"id": 5, "x": 0, "y": 0, "w": 1, "c": "#000000", "p": []},
                {"id": "ok2", "x": 1, "y": 1, "w": 2, "c": "#000000", "p": [0, 0], "t": "highlighter"}
            ]),
        );
        let strokes = read_ink(&canvas);
        assert_eq!(strokes.len(), 2);
        assert_eq!(strokes[0].id, "ok");
        assert_eq!(strokes[0].t, "pen");
        assert_eq!(strokes[1].id, "ok2");
        assert_eq!(strokes[1].t, "highlighter");
    }

    #[test]
    fn strokes_with_non_finite_numbers_are_not_written() {
        let mut canvas = Canvas::default();
        write_ink(
            &mut canvas,
            &[
                stroke("nan-x", f64::NAN, 0.0, 1.0, vec![0, 0]),
                stroke("inf-y", 0.0, f64::INFINITY, 1.0, vec![0, 0]),
                stroke("nan-w", 0.0, 0.0, f64::NAN, vec![0, 0]),
                stroke("ok", 0.0, 0.0, 1.0, vec![0, 0]),
            ],
        );
        let written = canvas.extra[INK_FIELD].as_array().unwrap();
        assert_eq!(written.len(), 1, "{written:?}");
        assert_eq!(written[0]["id"], "ok");
        assert!(parse_canvas(&canvas_text(&canvas)).is_ok());
    }

    #[test]
    fn a_point_near_a_stroke_hits_it_and_a_far_one_misses() {
        // Segment (0,0)-(10,0) with width 2 reaches 1 px either side of its line.
        let strokes = vec![
            stroke("line", 0.0, 0.0, 2.0, vec![0, 0, 100, 0]),
            stroke("dot", 5.0, 5.0, 2.0, vec![0, 0]),
        ];
        assert_eq!(strokes_hit(&strokes, 5.0, 0.5, 0.0), vec!["line"]);
        assert!(strokes_hit(&strokes, 5.0, 1.5, 0.0).is_empty());
        assert_eq!(strokes_hit(&strokes, 5.0, 5.5, 0.0), vec!["dot"]);
        assert!(strokes_hit(&strokes, 5.0, 7.0, 0.0).is_empty());
        assert_eq!(strokes_hit(&strokes, 5.0, -2.5, 2.0), vec!["line"]);
    }

    #[test]
    fn stroke_rect_grows_by_half_the_width() {
        let s = stroke("a", 0.0, 0.0, 4.0, vec![0, 0, 100, 50]);
        assert_eq!(
            stroke_rect(&s),
            Some(CanvasRect {
                x: -2.0,
                y: -2.0,
                width: 14.0,
                height: 9.0
            })
        );
    }

    #[test]
    fn odd_or_empty_points_have_no_rect_and_no_hit() {
        let odd = stroke("odd", 0.0, 0.0, 2.0, vec![0, 0, 10]);
        let empty = stroke("empty", 0.0, 0.0, 2.0, Vec::new());
        assert_eq!(stroke_rect(&odd), None);
        assert_eq!(stroke_rect(&empty), None);
        assert!(strokes_hit(&[odd, empty], 0.0, 0.0, 5.0).is_empty());
    }
}
