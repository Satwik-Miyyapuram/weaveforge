//! One clean band per line of a text highlight. A faithful port of
//! `apps/web/src/features/reader/application/normalize-highlight-rects.ts`.
//!
//! A browser selection's client rects over the PDF text layer overlap each other and reach into the
//! lines above and below. Painted as-is, every overlap shows twice. This merges the boxes of one line
//! into a single band and splits any overlap between two lines at its midpoint.
//!
//! Rects are PDF user space, `[x1, y1, x2, y2]` with a bottom-left origin.

/// Two boxes share a line when they overlap by at least this share of the shorter one.
const SAME_LINE: f64 = 0.5;
/// A horizontal gap below this share of the line height is the space between words.
const WORD_GAP: f64 = 0.6;

/// A normalised box `[left, bottom, right, top]`.
type Rect = [f64; 4];

/// One line of boxes while lines are being built.
struct Line {
    bottom: f64,
    top: f64,
    spans: Vec<Rect>,
}

/// Normalise a rect's corners and drop it when it is short, non-finite or empty.
fn as_rect(value: &[f64]) -> Option<Rect> {
    let [a, b, c, d] = <[f64; 4]>::try_from(value.get(..4)?).ok()?;
    if ![a, b, c, d].iter().all(|v| v.is_finite()) {
        return None;
    }
    let rect = [a.min(c), b.min(d), a.max(c), b.max(d)];
    (rect[2] - rect[0] > 0.0 && rect[3] - rect[1] > 0.0).then_some(rect)
}

/// Overlap of two vertical bands; negative when they do not touch.
fn vertical_overlap(top_a: f64, bottom_a: f64, top_b: f64, bottom_b: f64) -> f64 {
    top_a.min(top_b) - bottom_a.max(bottom_b)
}

/// Merge overlapping highlight rects into one band per line.
///
/// Fewer than two valid rects are returned as-is (normalised). Invalid rects (short, non-finite or
/// empty) are dropped.
#[must_use]
pub fn normalize_highlight_rects(rects: &[Vec<f64>]) -> Vec<Vec<f64>> {
    let mut boxes: Vec<Rect> = rects
        .iter()
        .map(Vec::as_slice)
        .filter_map(as_rect)
        .collect();
    if boxes.len() < 2 {
        return boxes.iter().map(|b| b.to_vec()).collect();
    }

    // Top of the page first (largest y), then left to right.
    boxes.sort_by(|a, b| {
        (b[3] + b[1])
            .total_cmp(&(a[3] + a[1]))
            .then_with(|| a[0].total_cmp(&b[0]))
    });

    let mut lines: Vec<Line> = Vec::new();
    for rect in boxes {
        let (bottom, top) = (rect[1], rect[3]);
        let height = top - bottom;
        let found = lines.iter_mut().find(|line| {
            vertical_overlap(line.top, line.bottom, top, bottom)
                >= SAME_LINE * height.min(line.top - line.bottom)
        });
        match found {
            Some(line) => {
                line.spans.push(rect);
                line.bottom = line.bottom.min(bottom);
                line.top = line.top.max(top);
            }
            None => lines.push(Line {
                bottom,
                top,
                spans: vec![rect],
            }),
        }
    }
    lines.sort_by(|a, b| (b.top + b.bottom).total_cmp(&(a.top + a.bottom)));

    // Split the overlap between consecutive lines at its midpoint.
    for i in 0..lines.len().saturating_sub(1) {
        let (upper_part, lower_part) = lines.split_at_mut(i + 1);
        let upper = &mut upper_part[i];
        let lower = &mut lower_part[0];
        if vertical_overlap(upper.top, upper.bottom, lower.top, lower.bottom) > 0.0 {
            let mid = (upper.bottom + lower.top) / 2.0;
            upper.bottom = mid;
            lower.top = mid;
        }
    }

    let mut out: Vec<Vec<f64>> = Vec::new();
    for line in &lines {
        let gap = WORD_GAP * (line.top - line.bottom);
        let mut spans = line.spans.clone();
        spans.sort_by(|a, b| a[0].total_cmp(&b[0]));
        let mut left = spans[0][0];
        let mut right = spans[0][2];
        for span in &spans[1..] {
            if span[0] <= right + gap {
                right = right.max(span[2]);
            } else {
                out.push(vec![left, line.bottom, right, line.top]);
                left = span[0];
                right = span[2];
            }
        }
        out.push(vec![left, line.bottom, right, line.top]);
    }
    out
}
