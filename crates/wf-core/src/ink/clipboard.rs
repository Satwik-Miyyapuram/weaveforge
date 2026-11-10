//! Clipboard text for copied figures and lassoed strokes, and where pasted ones land.
//!
//! A port of `figure-clipboard.ts` and `stroke-clipboard.ts`. Each clip is one line
//! of text, prefixed so a paste elsewhere says what it is. Parsing is lenient, as the
//! TypeScript was: a field that is missing or of the wrong shape is dropped, and a
//! stroke that is not usable is skipped rather than failing the whole paste.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::figure::{FigureBox, FigurePlacement, FigureRect, keep_figure_on_page};
use super::ink_page::{
    InkColour, InkPageSize, InkShape, InkStroke, InkStrokeInput, InkTool, make_ink_stroke,
};

const FIGURE_PREFIX: &str = "weaveforge-figure:";
const STROKE_PREFIX: &str = "weaveforge-ink:";
/// How far a paste steps while it lands on the same spot as something already there.
const PASTE_STEP: f64 = 50.0;
/// How many steps a paste may take before it stops looking for a free spot.
const PASTE_TRIES: usize = 20;

/// What a copied figure carries: the note that owns its attachment, and the figure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FigureClip {
    /// The note that owns the figure's attachment.
    pub note_id: String,
    /// The figure, with its attachment path and geometry.
    pub figure: FigurePlacement,
}

/// The clipboard text for a copied figure.
#[must_use]
pub fn figure_clip_text(clip: &FigureClip) -> String {
    // Serializing this plain struct cannot fail; NaN becomes `null`, as in JSON.stringify.
    let json = serde_json::to_string(clip).unwrap_or_default();
    format!("{FIGURE_PREFIX}{json}")
}

/// The figure a clipboard text names, or `None` when it names none.
#[must_use]
pub fn parse_figure_clip(text: Option<&str>) -> Option<FigureClip> {
    let body = text?.strip_prefix(FIGURE_PREFIX)?;
    let clip: Value = serde_json::from_str(body).ok()?;
    let note_id = clip.get("noteId")?.as_str()?.to_owned();
    let figure = clip.get("figure")?;
    let path = figure.get("path")?.as_str()?.to_owned();
    let x = figure.get("x").and_then(Value::as_f64)?;
    let y = figure.get("y").and_then(Value::as_f64)?;
    let w = figure.get("w").and_then(Value::as_f64)?;
    let h = figure.get("h").and_then(Value::as_f64)?;
    // A crop is kept only when it is four finite numbers; anything else is dropped.
    let crop = figure
        .get("crop")
        .and_then(Value::as_array)
        .and_then(|values| finite_numbers(values))
        .and_then(|values| <[f64; 4]>::try_from(values).ok());
    Some(FigureClip {
        note_id,
        figure: FigurePlacement {
            path,
            x,
            y,
            w,
            h,
            crop,
        },
    })
}

/// Where a pasted figure goes: where it was copied from, stepped down and right past
/// any figure already sitting exactly there, then kept on the page.
#[must_use]
pub fn pasted_figure_place(
    figure: &FigurePlacement,
    on_page: &[FigureBox],
    page: InkPageSize,
) -> FigurePlacement {
    let mut x = figure.x;
    let mut y = figure.y;
    for _ in 0..PASTE_TRIES {
        if !on_page.iter().any(|one| one.x == x && one.y == y) {
            break;
        }
        x += PASTE_STEP;
        y += PASTE_STEP;
    }
    let (x, y) = keep_figure_on_page(
        FigureRect {
            x,
            y,
            w: figure.w,
            h: figure.h,
        },
        page.width,
        page.height,
    );
    FigurePlacement {
        x,
        y,
        ..figure.clone()
    }
}

/// One stroke as the clipboard keeps it: its ink, not its place in the page's history.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipStroke {
    points: Vec<f64>,
    pressures: Vec<f64>,
    width: f64,
    tool: InkTool,
    colour: InkColour,
    shape: InkShape,
}

/// The strokes in a clipboard text.
#[derive(Debug, Serialize)]
struct StrokeClipPayload {
    strokes: Vec<ClipStroke>,
}

/// The clipboard text for a set of strokes.
#[must_use]
pub fn stroke_clip_text(strokes: &[InkStroke]) -> String {
    let payload = StrokeClipPayload {
        strokes: strokes
            .iter()
            .map(|stroke| ClipStroke {
                points: stroke.points.clone(),
                pressures: stroke.pressures.clone(),
                width: stroke.width,
                tool: stroke.tool,
                colour: stroke.colour,
                shape: stroke.shape,
            })
            .collect(),
    };
    // Serializing this plain struct cannot fail; NaN becomes `null`, as in JSON.stringify.
    let json = serde_json::to_string(&payload).unwrap_or_default();
    format!("{STROKE_PREFIX}{json}")
}

/// The strokes a clipboard text carries, or `None` when it carries none usable.
#[must_use]
pub fn parse_stroke_clip(text: Option<&str>) -> Option<Vec<InkStroke>> {
    let body = text?.strip_prefix(STROKE_PREFIX)?;
    let clip: Value = serde_json::from_str(body).ok()?;
    let raws = clip.get("strokes")?.as_array()?;
    let mut out = Vec::new();
    for raw in raws {
        let Some(points) = raw.get("points").and_then(Value::as_array) else {
            continue;
        };
        // Pairs of coordinates, at least two of them, all finite.
        if points.len() < 4 || points.len() % 2 != 0 {
            continue;
        }
        let Some(points) = finite_numbers(points) else {
            continue;
        };
        let pressures = raw
            .get("pressures")
            .and_then(Value::as_array)
            .and_then(|values| finite_numbers(values))
            .unwrap_or_default();
        out.push(make_ink_stroke(InkStrokeInput {
            points,
            pressures: Some(pressures),
            width: raw.get("width").and_then(Value::as_f64),
            tool: one_of(raw.get("tool")),
            colour: one_of(raw.get("colour")),
            shape: one_of(raw.get("shape")),
            ..InkStrokeInput::default()
        }));
    }
    (!out.is_empty()).then_some(out)
}

/// Where pasted strokes land: where they were copied from, stepped down and right
/// while that spot already holds a stroke's start, then moved back onto the page.
#[must_use]
pub fn pasted_strokes_place(
    strokes: &[InkStroke],
    on_page: &[InkStroke],
    page: InkPageSize,
) -> Vec<InkStroke> {
    let Some(first) = strokes.first() else {
        return Vec::new();
    };
    let starts: Vec<(f64, f64)> = on_page.iter().filter_map(stroke_start).collect();
    let mut dx = 0.0;
    let mut dy = 0.0;
    if let Some((first_x, first_y)) = stroke_start(first) {
        for _ in 0..PASTE_TRIES {
            if !starts.contains(&(first_x + dx, first_y + dy)) {
                break;
            }
            dx += PASTE_STEP;
            dy += PASTE_STEP;
        }
    }
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for stroke in strokes {
        for &[x, y] in stroke.points.as_chunks::<2>().0 {
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
        }
    }
    dx = clamp_shift(min_x + dx, max_x + dx, page.width) + dx;
    dy = clamp_shift(min_y + dy, max_y + dy, page.height) + dy;
    strokes
        .iter()
        .map(|stroke| InkStroke {
            points: stroke
                .points
                .iter()
                .enumerate()
                .map(|(i, v)| v + if i % 2 == 0 { dx } else { dy })
                .collect(),
            ..stroke.clone()
        })
        .collect()
}

/// The first point of a stroke, when it has one.
fn stroke_start(stroke: &InkStroke) -> Option<(f64, f64)> {
    match stroke.points.as_slice() {
        [x, y, ..] => Some((*x, *y)),
        _ => None,
    }
}

/// The extra shift that keeps `[lo, hi]` inside `[0, size]` where it fits.
fn clamp_shift(lo: f64, hi: f64, size: f64) -> f64 {
    if lo < 0.0 {
        -lo
    } else if hi > size {
        (-lo).max(size - hi)
    } else {
        0.0
    }
}

/// Every element as a finite number, or `None` when one is not.
fn finite_numbers(values: &[Value]) -> Option<Vec<f64>> {
    values
        .iter()
        .map(|value| value.as_f64().filter(|n| n.is_finite()))
        .collect()
}

/// A value as one of the enum's names, or `None` when it is not one of them.
fn one_of<T: DeserializeOwned>(value: Option<&Value>) -> Option<T> {
    value.and_then(|value| T::deserialize(value).ok())
}
