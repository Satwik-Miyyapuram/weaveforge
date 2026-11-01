//! Line segmentation: a page's strokes grouped into the lines a recogniser
//! reads (§5.4). A port of `packages/core/src/ink/segment.ts`.
//!
//! Strokes arrive in time order, so a stroke joins the line being built when it
//! starts soon enough after it and sits at the same height. Only pen strokes are
//! segmented; highlighter and shape strokes are not writing.

use std::cmp::Ordering;

use super::js_math;

/// Idle gap, in ms, after which a stroke starts a new line rather than joining one.
pub const INK_GROUP_WINDOW_MS: f64 = 2_000.0;

/// How far a stroke's centre may sit from the line's, as a fraction of the
/// running median stroke height.
pub const INK_LINE_BAND_RATIO: f64 = 0.6;

/// The fields of a stroke that segmentation reads.
#[derive(Debug, Clone, PartialEq, Default, serde::Deserialize)]
pub struct SegmentStroke {
    /// Flat x,y pairs.
    pub points: Vec<f64>,
    /// `"pen"`, `"highlighter"`, ...; only `"pen"` is segmented.
    pub tool: String,
    /// Stroke start in ms; a missing or non-finite value falls back to the
    /// stroke's index.
    #[serde(default)]
    pub t0: Option<f64>,
}

/// One line: the input indices of its strokes and its `[yMin, yMax]` band.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkLineIndices {
    /// Indices into the input strokes, in the order they joined the line.
    pub stroke_indices: Vec<u32>,
    /// `[yMin, yMax]` over the line's strokes.
    pub y_band: [f64; 2],
}

/// Lines top to bottom, and the line each input stroke went into (`-1` for none).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkSegmentationIndices {
    /// Lines in reading order, top to bottom.
    pub lines: Vec<InkLineIndices>,
    /// The line each input stroke went into, `-1` when it was not segmented.
    pub line_of_stroke: Vec<i32>,
}

/// A stroke's vertical extent over its finite y values, or `None` when it has none.
#[must_use]
pub fn ink_stroke_band(points: &[f64]) -> Option<(f64, f64)> {
    let mut y_min = f64::INFINITY;
    let mut y_max = f64::NEG_INFINITY;
    for &y in points.iter().skip(1).step_by(2) {
        if !y.is_finite() {
            continue;
        }
        if y < y_min {
            y_min = y;
        }
        if y > y_max {
            y_max = y;
        }
    }
    y_min.is_finite().then_some((y_min, y_max))
}

fn start_time(stroke: &SegmentStroke, index: usize) -> f64 {
    match stroke.t0 {
        Some(t0) if t0.is_finite() => t0,
        _ => index as f64,
    }
}

/// JS `a - b` as a sort comparator: equal when the difference is 0 (so -0 == 0).
fn js_compare(a: f64, b: f64) -> Ordering {
    a.partial_cmp(&b).unwrap_or(Ordering::Equal)
}

struct Draft {
    indices: Vec<u32>,
    y_min: f64,
    y_max: f64,
    last_at: f64,
    /// Stroke heights, kept sorted so the median is one lookup.
    heights: Vec<f64>,
}

/// Groups a page's strokes into lines.
///
/// Walking the pen strokes in time order, a stroke joins the current line when
/// its y-centre is within `band_ratio` of the running median stroke height
/// around the line's band and it started within `window_ms` of the line's last
/// stroke. Otherwise it starts a new line. Lines come back sorted top to bottom.
#[must_use]
pub fn segment_ink_lines(
    strokes: &[SegmentStroke],
    window_ms: f64,
    band_ratio: f64,
) -> InkSegmentationIndices {
    let mut line_of_stroke = vec![-1; strokes.len()];
    let mut drafts: Vec<Draft> = Vec::new();

    let mut order: Vec<usize> = (0..strokes.len())
        .filter(|&i| strokes[i].tool == "pen" && strokes[i].points.len() >= 4)
        .collect();
    order.sort_by(|&a, &b| js_compare(start_time(&strokes[a], a), start_time(&strokes[b], b)));

    for index in order {
        let stroke = &strokes[index];
        let Some((y_min, y_max)) = ink_stroke_band(&stroke.points) else {
            continue;
        };
        let centre = (y_min + y_max) / 2.0;
        let height = y_max - y_min;
        let at = start_time(stroke, index);

        let mut joined = false;
        if let Some(current) = drafts.last_mut()
            && at - current.last_at <= window_ms
        {
            let median = median_of_sorted(&current.heights);
            let current_centre = (current.y_min + current.y_max) / 2.0;
            let tolerance = js_math::max(band_ratio * median, 1.0);
            if (centre - current_centre).abs() <= tolerance {
                current.indices.push(index as u32);
                current.y_min = js_math::min(current.y_min, y_min);
                current.y_max = js_math::max(current.y_max, y_max);
                current.last_at = js_math::max(current.last_at, at);
                insert_sorted(&mut current.heights, height);
                joined = true;
            }
        }
        if !joined {
            drafts.push(Draft {
                indices: vec![index as u32],
                y_min,
                y_max,
                last_at: at,
                heights: vec![height],
            });
        }
    }

    // Reading order is top to bottom, not the order the lines were written in.
    drafts.sort_by(|a, b| js_compare(a.y_min, b.y_min));

    let lines = drafts
        .into_iter()
        .enumerate()
        .map(|(line_index, draft)| {
            for &index in &draft.indices {
                line_of_stroke[index as usize] = line_index as i32;
            }
            InkLineIndices {
                stroke_indices: draft.indices,
                y_band: [draft.y_min, draft.y_max],
            }
        })
        .collect();

    InkSegmentationIndices {
        lines,
        line_of_stroke,
    }
}

/// Median of an already-sorted slice; `0` for an empty one.
fn median_of_sorted(sorted: &[f64]) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let middle = sorted.len() >> 1;
    if sorted.len() % 2 == 1 {
        sorted[middle]
    } else {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    }
}

/// Binary insertion keeps `sorted` sorted without re-sorting every stroke.
fn insert_sorted(sorted: &mut Vec<f64>, value: f64) {
    let mut low = 0;
    let mut high = sorted.len();
    while low < high {
        let middle = (low + high) >> 1;
        if sorted[middle] < value {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    sorted.insert(low, value);
}

/// One line as the container stores it.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkLineRecord {
    /// First stroke of the line in the stored (line-ordered) stroke list.
    pub stroke_start: u32,
    /// Number of strokes in the line.
    pub stroke_count: u32,
    /// Rounded top of the line's band.
    pub y_min: f64,
    /// Rounded bottom of the line's band.
    pub y_max: f64,
    /// The recognised text, `""` when there is none.
    pub text: String,
    /// The engine's confidence, `0` when there is none.
    pub confidence: f64,
}

/// What recognition produced for one line.
#[derive(Debug, Clone, PartialEq, Default, serde::Deserialize)]
pub struct RecognisedLineText {
    /// The recognised text.
    #[serde(default)]
    pub text: Option<String>,
    /// The engine's confidence.
    #[serde(default)]
    pub confidence: Option<f64>,
}

/// The line records for lines stored one after another, given each line's
/// stroke count, band and recognised text (`None` when the line has none).
#[must_use]
pub fn ink_line_records(
    lines: &[(u32, [f64; 2])],
    recognised: &[Option<RecognisedLineText>],
) -> Vec<InkLineRecord> {
    let mut stroke_start = 0u32;
    lines
        .iter()
        .enumerate()
        .map(|(i, &(stroke_count, [y_min, y_max]))| {
            let text = recognised.get(i).and_then(Option::as_ref);
            let record = InkLineRecord {
                stroke_start,
                stroke_count,
                y_min: js_math::round(y_min),
                y_max: js_math::round(y_max),
                text: text.and_then(|t| t.text.clone()).unwrap_or_default(),
                confidence: text.and_then(|t| t.confidence).unwrap_or(0.0),
            };
            stroke_start += stroke_count;
            record
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pen(points: &[f64], t0: f64) -> SegmentStroke {
        SegmentStroke {
            points: points.to_vec(),
            tool: "pen".into(),
            t0: Some(t0),
        }
    }

    #[test]
    fn strokes_on_one_line_written_quickly_group_together() {
        let strokes = [
            pen(&[0.0, 100.0, 10.0, 140.0], 0.0),
            pen(&[20.0, 105.0, 30.0, 138.0], 300.0),
        ];
        let s = segment_ink_lines(&strokes, INK_GROUP_WINDOW_MS, INK_LINE_BAND_RATIO);
        assert_eq!(s.lines.len(), 1);
        assert_eq!(s.lines[0].stroke_indices, vec![0, 1]);
        assert_eq!(s.lines[0].y_band, [100.0, 140.0]);
        assert_eq!(s.line_of_stroke, vec![0, 0]);
    }

    #[test]
    fn a_long_pause_or_another_height_starts_a_new_line_sorted_top_down() {
        let strokes = [
            pen(&[0.0, 500.0, 10.0, 540.0], 0.0),
            pen(&[0.0, 100.0, 10.0, 140.0], 100.0),
            pen(&[0.0, 105.0, 10.0, 135.0], 5_000.0),
        ];
        let s = segment_ink_lines(&strokes, INK_GROUP_WINDOW_MS, INK_LINE_BAND_RATIO);
        assert_eq!(s.lines.len(), 3);
        assert_eq!(s.line_of_stroke, vec![2, 0, 1]);
    }

    #[test]
    fn non_pen_short_and_pointless_strokes_are_not_segmented() {
        let mut highlighter = pen(&[0.0, 1.0, 2.0, 3.0], 0.0);
        highlighter.tool = "highlighter".into();
        let strokes = [highlighter, pen(&[0.0, 1.0], 0.0), pen(&[f64::NAN; 4], 0.0)];
        let s = segment_ink_lines(&strokes, INK_GROUP_WINDOW_MS, INK_LINE_BAND_RATIO);
        assert!(s.lines.is_empty());
        assert_eq!(s.line_of_stroke, vec![-1, -1, -1]);
    }

    #[test]
    fn records_run_on_from_each_other_and_round_their_band() {
        let recognised = [Some(RecognisedLineText {
            text: Some("hi".into()),
            confidence: Some(0.5),
        })];
        let r = ink_line_records(&[(2, [10.5, 20.4]), (3, [-2.5, 1.0])], &recognised);
        assert_eq!((r[0].stroke_start, r[0].stroke_count), (0, 2));
        assert_eq!((r[0].y_min, r[0].y_max), (11.0, 20.0));
        assert_eq!((r[0].text.as_str(), r[0].confidence), ("hi", 0.5));
        assert_eq!((r[1].stroke_start, r[1].y_min), (2, -2.0));
        assert_eq!((r[1].text.as_str(), r[1].confidence), ("", 0.0));
    }
}
