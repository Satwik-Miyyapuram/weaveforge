//! Canvas view of an imported OneNote page. Positioned outlines become text
//! nodes; images and ink notes become file nodes. Layout is kept in 0.1 mm, as
//! OneNote stores it, and the canvas is written in pixels at 96 per inch, so one
//! half inch of OneNote space is 48 canvas pixels.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Pixels per half inch on the canvas.
const PX_PER_HALF_INCH: f64 = 48.0;
/// OneNote's half inch in 0.1 mm.
const HALF_INCH_TENTHS_MM: f64 = 127.0;
/// Gap between stacked nodes, in pixels.
const STACK_GAP: f64 = PX_PER_HALF_INCH;
/// Size of a text or image node that has no size of its own, in pixels.
const DEFAULT_WIDTH: f64 = PX_PER_HALF_INCH * 8.0;
const DEFAULT_HEIGHT: f64 = PX_PER_HALF_INCH * 4.0;
/// Keeps every coordinate inside the range a JSON Canvas reader can hold exactly.
const COORD_LIMIT: f64 = 1.0e12;

/// What a layout item is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum LayoutKind {
    /// Positioned outline text, held in `text`.
    Text,
    /// An image, named by `key`; the caller maps the key to a vault path.
    Image,
    /// An ink note part, keyed `ink-N` for the Nth note part of the page.
    Ink,
}

/// One positioned piece of an imported page, in 0.1 mm. Missing geometry means
/// the piece has no place on the page and is stacked under the placed ones.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OneNoteLayoutItem {
    /// Text, image or ink.
    pub kind: LayoutKind,
    /// Image name, or `ink-N` for ink; empty for text.
    pub key: String,
    /// Markdown for a text item; empty otherwise.
    pub text: String,
    /// Left edge.
    pub x: Option<f64>,
    /// Top edge.
    pub y: Option<f64>,
    /// Width.
    pub width: Option<f64>,
    /// Height.
    pub height: Option<f64>,
}

/// A node before it is numbered and given its coordinates.
struct Draft {
    content: Content,
    x: Option<f64>,
    y: Option<f64>,
    width: f64,
    height: f64,
}

enum Content {
    Text(String),
    File(String),
}

/// JSON Canvas text for a page's layout. `files` maps each image name and each
/// `ink-N` key to the vault path it was imported to; items without a path are
/// left out. Text items with nothing in them are left out too.
#[must_use]
pub fn page_canvas(layout: &[OneNoteLayoutItem], files: &BTreeMap<String, String>) -> String {
    let drafts: Vec<Draft> = layout
        .iter()
        .filter_map(|item| draft(item, files))
        .collect();

    // Loose pieces go in a column under everything placed, so they never overlap it.
    let bottom = drafts
        .iter()
        .filter(|draft| draft.x.is_some() && draft.y.is_some())
        .map(|draft| draft.y.unwrap_or(0.0) + draft.height)
        .reduce(f64::max);
    let mut cursor = bottom.map_or(0.0, |edge| edge + STACK_GAP);
    let mut nodes = Vec::with_capacity(drafts.len());
    for draft in drafts {
        let draft = if draft.x.is_some() && draft.y.is_some() {
            draft
        } else {
            let y = cursor;
            cursor += draft.height + STACK_GAP;
            Draft {
                x: Some(0.0),
                y: Some(y),
                ..draft
            }
        };
        nodes.push(node_json(nodes.len() + 1, &draft));
    }
    json!({ "nodes": nodes, "edges": [] }).to_string()
}

/// The draft for an item, or `None` when it has nothing to show.
fn draft(item: &OneNoteLayoutItem, files: &BTreeMap<String, String>) -> Option<Draft> {
    let content = match item.kind {
        LayoutKind::Text => {
            if item.text.trim().is_empty() {
                return None;
            }
            Content::Text(item.text.clone())
        }
        LayoutKind::Image | LayoutKind::Ink => Content::File(files.get(&item.key)?.clone()),
    };
    let is_text = matches!(content, Content::Text(_));
    let default_width = DEFAULT_WIDTH;
    let default_height = if is_text {
        DEFAULT_HEIGHT
    } else {
        DEFAULT_WIDTH * 0.75
    };
    Some(Draft {
        content,
        x: finite(item.x).map(px),
        y: finite(item.y).map(px),
        width: finite(item.width)
            .filter(|v| *v > 0.0)
            .map_or(default_width, px),
        height: finite(item.height)
            .filter(|v| *v > 0.0)
            .map_or(default_height, px),
    })
}

fn finite(value: Option<f64>) -> Option<f64> {
    value.filter(|v| v.is_finite())
}

/// 0.1 mm to canvas pixels.
fn px(tenths: f64) -> f64 {
    tenths * PX_PER_HALF_INCH / HALF_INCH_TENTHS_MM
}

/// Whole pixels, bounded so the cast cannot overflow.
#[allow(clippy::cast_possible_truncation)]
fn whole(value: f64) -> i64 {
    value.round().clamp(-COORD_LIMIT, COORD_LIMIT) as i64
}

fn node_json(number: usize, draft: &Draft) -> Value {
    let id = format!("onenote-{number}");
    let x = whole(draft.x.unwrap_or(0.0));
    let y = whole(draft.y.unwrap_or(0.0));
    let width = whole(draft.width);
    let height = whole(draft.height);
    match &draft.content {
        Content::Text(text) => json!({
            "id": id, "type": "text", "text": text,
            "x": x, "y": y, "width": width, "height": height,
        }),
        Content::File(path) => json!({
            "id": id, "type": "file", "file": path,
            "x": x, "y": y, "width": width, "height": height,
        }),
    }
}
