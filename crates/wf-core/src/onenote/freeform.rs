//! Freeform page of an imported OneNote page: typed text and pictures placed at their
//! OneNote positions as canvas nodes, and ink as real strokes in the canvas `wfInk` field.
//! OneNote stores layout in 0.1 mm, as the canvas is written in pixels at 96 per inch, so
//! one half inch of OneNote space is 48 canvas pixels.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::canvas::{Canvas, CanvasNode, FreeStroke, canvas_text, write_ink};
use crate::ink::ink_page::{InkPage, InkTool};
use crate::onenote::ink::colour_hex;

/// Pixels per half inch on the canvas.
const PX_PER_HALF_INCH: f64 = 48.0;
/// OneNote's half inch in 0.1 mm.
const HALF_INCH_TENTHS_MM: f64 = 127.0;
/// Gap between stacked nodes, in pixels.
const STACK_GAP: f64 = PX_PER_HALF_INCH;
/// Size of a text or image node that has no size of its own, in pixels.
const DEFAULT_WIDTH: f64 = PX_PER_HALF_INCH * 8.0;
const DEFAULT_TEXT_HEIGHT: f64 = PX_PER_HALF_INCH * 4.0;
const DEFAULT_IMAGE_HEIGHT: f64 = DEFAULT_WIDTH * 0.75;
/// Keeps every coordinate inside the range a JSON Canvas reader can hold exactly.
const COORD_LIMIT: f64 = 1.0e12;

/// What a layout item is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum LayoutKind {
    /// Typed outline text, held in `text`.
    Text,
    /// A picture, named by `key`; the caller maps the key to a vault path.
    Image,
}

/// One positioned piece of an imported page, in 0.1 mm. Missing geometry means the piece
/// has no place on the page and is stacked under the placed ones.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OneNoteLayoutItem {
    /// Text or image.
    pub kind: LayoutKind,
    /// Image name; empty for text.
    pub key: String,
    /// Markdown for a text item; alt text for an image.
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

/// JSON Canvas text for a freeform page: `layout` as nodes (images map to vault paths
/// through `files`), `strokes` in the `wfInk` field. Coordinates are canvas pixels.
#[must_use]
pub fn freeform_canvas(
    layout: &[OneNoteLayoutItem],
    files: &BTreeMap<String, String>,
    strokes: &[FreeStroke],
) -> String {
    let drafts: Vec<Draft> = layout.iter().filter_map(|item| draft(item, files)).collect();

    // Loose pieces go in a column under everything placed, so they never overlap it.
    let bottom = drafts
        .iter()
        .filter_map(|d| d.placed().map(|(_, y)| y + d.height))
        .reduce(f64::max);
    let mut cursor = bottom.map_or(0.0, |edge| edge + STACK_GAP);
    let mut nodes = Vec::with_capacity(drafts.len());
    for (index, draft) in drafts.into_iter().enumerate() {
        let (x, y) = match draft.placed() {
            Some(at) => at,
            None => {
                let y = cursor;
                cursor += draft.height + STACK_GAP;
                (0.0, y)
            }
        };
        let (kind, text, file) = match draft.content {
            Content::Text(text) => ("text", Some(text), None),
            Content::File(path) => ("file", None, Some(path)),
        };
        nodes.push(CanvasNode {
            id: format!("onenote-{}", index + 1),
            kind: kind.to_owned(),
            text,
            file,
            x: bound(x),
            y: bound(y),
            width: bound(draft.width),
            height: bound(draft.height),
            ..CanvasNode::default()
        });
    }

    let mut canvas = Canvas {
        nodes,
        ..Canvas::default()
    };
    write_ink(&mut canvas, strokes);
    canvas_text(&canvas)
}

/// A layout item once its content and size are known, in canvas pixels.
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

impl Draft {
    /// The top-left corner, when the item has a place on the page.
    fn placed(&self) -> Option<(f64, f64)> {
        self.x.zip(self.y)
    }
}

/// The draft for an item, or `None` when it has nothing to show.
fn draft(item: &OneNoteLayoutItem, files: &BTreeMap<String, String>) -> Option<Draft> {
    let (content, default_height) = match item.kind {
        LayoutKind::Text => {
            if item.text.trim().is_empty() {
                return None;
            }
            (Content::Text(item.text.clone()), DEFAULT_TEXT_HEIGHT)
        }
        LayoutKind::Image => (Content::File(files.get(&item.key)?.clone()), DEFAULT_IMAGE_HEIGHT),
    };
    Some(Draft {
        content,
        x: finite(item.x).map(px),
        y: finite(item.y).map(px),
        width: finite(item.width)
            .filter(|v| *v > 0.0)
            .map_or(DEFAULT_WIDTH, px),
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

/// Whole pixels, bounded so the value stays exact in a JSON Canvas reader.
fn bound(value: f64) -> f64 {
    value.round().clamp(-COORD_LIMIT, COORD_LIMIT)
}

/// Strokes of an ink page placed at `origin` (0.1 mm on the OneNote page), in canvas
/// pixels. Points that are not finite are dropped; a stroke left with no points is dropped.
#[must_use]
pub fn ink_strokes(origin: (f64, f64), page: &InkPage, id_prefix: &str) -> Vec<FreeStroke> {
    page.strokes
        .iter()
        .enumerate()
        .filter_map(|(index, stroke)| {
            let id = format!("{id_prefix}-{}", index + 1);
            let points: Vec<(f64, f64)> = stroke
                .points
                .chunks_exact(2)
                .map(|pair| (px(origin.0 + pair[0]), px(origin.1 + pair[1])))
                .collect();
            if points.is_empty() || stroke.points.len() % 2 == 1 || !stroke.points.iter().all(|v| v.is_finite()) {
                return None;
            }
            // The stroke sits at its first point, rounded to whole pixels as the canvas
            // stores it; every other point is an offset from that in tenths of a pixel.
            let (x, y) = (bound(points[0].0), bound(points[0].1));
            let p = points
                .iter()
                .flat_map(|&(px_x, px_y)| [tenths_from(px_x - x), tenths_from(px_y - y)])
                .collect();
            let r = if stroke.pressures.len() == points.len() {
                stroke
                    .pressures
                    .iter()
                    .map(|v| v.round().clamp(0.0, 255.0) as u8)
                    .collect()
            } else {
                Vec::new()
            };
            Some(FreeStroke {
                id,
                x,
                y,
                w: px(stroke.width).max(0.0),
                c: colour_hex(stroke.colour),
                t: match stroke.tool {
                    InkTool::Highlighter => "highlighter".to_owned(),
                    InkTool::Pen | InkTool::Shape => "pen".to_owned(),
                },
                p,
                r,
                extra: serde_json::Map::new(),
            })
        })
        .collect()
}

/// A pixel offset as whole tenths of a pixel, saturating at the `i32` range.
#[allow(clippy::cast_possible_truncation)]
fn tenths_from(offset: f64) -> i32 {
    (offset * 10.0).round().clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canvas::{INK_FIELD, parse_canvas, read_ink};
    use crate::ink::ink_page::{InkColour, InkShape, InkStroke, blank_ink_page};
    use crate::sync::ink_note::InkPaper;

    fn text(x: Option<f64>, y: Option<f64>, body: &str) -> OneNoteLayoutItem {
        OneNoteLayoutItem {
            kind: LayoutKind::Text,
            key: String::new(),
            text: body.to_owned(),
            x,
            y,
            width: Some(254.0),
            height: Some(127.0),
        }
    }

    fn image(key: &str, x: Option<f64>, y: Option<f64>) -> OneNoteLayoutItem {
        OneNoteLayoutItem {
            kind: LayoutKind::Image,
            key: key.to_owned(),
            text: "alt".to_owned(),
            x,
            y,
            width: None,
            height: None,
        }
    }

    fn parsed(text: &str) -> crate::canvas::Canvas {
        parse_canvas(text).expect("freeform output is JSON Canvas")
    }

    fn stroke(id: &str, p: Vec<i32>) -> FreeStroke {
        FreeStroke {
            id: id.to_owned(),
            x: 48.0,
            y: 96.0,
            w: 4.0,
            c: "#dc2626".to_owned(),
            t: "pen".to_owned(),
            p,
            r: Vec::new(),
            extra: serde_json::Map::new(),
        }
    }

    #[test]
    fn positioned_text_lands_at_its_pixel_position() {
        let canvas = parsed(&freeform_canvas(&[text(Some(127.0), Some(254.0), "typed")], &BTreeMap::new(), &[]));
        let node = &canvas.nodes[0];
        assert_eq!((node.kind.as_str(), node.x, node.y), ("text", 48.0, 96.0));
        assert_eq!((node.width, node.height), (96.0, 48.0));
        assert_eq!(node.text.as_deref(), Some("typed"));
    }

    #[test]
    fn unpositioned_text_gets_the_default_size_and_stacks_under_placed_content() {
        let layout = [
            text(Some(0.0), Some(0.0), "placed"),
            OneNoteLayoutItem { width: None, height: None, ..text(None, None, "loose") },
        ];
        let canvas = parsed(&freeform_canvas(&layout, &BTreeMap::new(), &[]));
        let loose = &canvas.nodes[1];
        assert_eq!((loose.x, loose.y), (0.0, 96.0));
        assert_eq!((loose.width, loose.height), (384.0, 192.0));
    }

    #[test]
    fn nan_and_infinite_positions_count_as_missing() {
        let layout = [text(Some(f64::NAN), Some(f64::INFINITY), "odd")];
        let canvas = parsed(&freeform_canvas(&layout, &BTreeMap::new(), &[]));
        assert_eq!((canvas.nodes[0].x, canvas.nodes[0].y), (0.0, 0.0));
    }

    #[test]
    fn huge_positions_are_clamped_to_the_coordinate_limit() {
        let layout = [text(Some(1.0e300), Some(-1.0e300), "far")];
        let canvas = parsed(&freeform_canvas(&layout, &BTreeMap::new(), &[]));
        assert_eq!((canvas.nodes[0].x, canvas.nodes[0].y), (1.0e12, -1.0e12));
    }

    #[test]
    fn blank_text_is_left_out() {
        let canvas = parsed(&freeform_canvas(&[text(Some(0.0), Some(0.0), "  ")], &BTreeMap::new(), &[]));
        assert!(canvas.nodes.is_empty());
    }

    #[test]
    fn image_becomes_a_file_node_at_its_vault_path() {
        let files = BTreeMap::from([("image-1.png".to_owned(), "attachments/abc.png".to_owned())]);
        let layout = [image("image-1.png", Some(127.0), Some(127.0))];
        let canvas = parsed(&freeform_canvas(&layout, &files, &[]));
        let node = &canvas.nodes[0];
        assert_eq!(node.kind, "file");
        assert_eq!(node.file.as_deref(), Some("attachments/abc.png"));
        assert_eq!((node.x, node.y, node.width, node.height), (48.0, 48.0, 384.0, 288.0));
    }

    #[test]
    fn image_without_a_vault_path_is_dropped() {
        let layout = [image("image-9.png", Some(0.0), Some(0.0))];
        let canvas = parsed(&freeform_canvas(&layout, &BTreeMap::new(), &[]));
        assert!(canvas.nodes.is_empty());
    }

    #[test]
    fn strokes_are_written_to_the_ink_field_not_as_nodes() {
        let out = freeform_canvas(&[], &BTreeMap::new(), &[stroke("s1", vec![0, 0, 480, 480])]);
        let canvas = parsed(&out);
        assert!(canvas.nodes.is_empty());
        assert!(canvas.extra.contains_key(INK_FIELD));
        assert_eq!(read_ink(&canvas), vec![stroke("s1", vec![0, 0, 480, 480])]);
    }

    #[test]
    fn a_page_with_no_strokes_has_no_ink_field() {
        let out = freeform_canvas(&[text(Some(0.0), Some(0.0), "x")], &BTreeMap::new(), &[]);
        assert!(!out.contains(INK_FIELD));
    }

    #[test]
    fn ink_is_placed_at_its_sheet_origin_in_pixels() {
        let mut page = blank_ink_page(InkPaper::Blank);
        page.strokes.push(InkStroke {
            points: vec![0.0, 0.0, 127.0, 127.0],
            pressures: vec![0.0, 255.0],
            width: 127.0,
            tool: InkTool::Pen,
            colour: InkColour::Red,
            t0: 0.0,
            shape: InkShape::None,
            line_index: -1.0,
        });
        let strokes = ink_strokes((127.0, 254.0), &page, "ink");
        assert_eq!(strokes.len(), 1);
        let s = &strokes[0];
        assert_eq!((s.x, s.y), (48.0, 96.0));
        assert_eq!(s.p, vec![0, 0, 480, 480]);
        assert_eq!(s.c, "#dc2626");
        assert_eq!(s.t, "pen");
        assert_eq!(s.r, vec![0, 255]);
        assert_eq!(s.w, 48.0);
    }

    #[test]
    fn highlighter_strokes_keep_their_tool() {
        let mut page = blank_ink_page(InkPaper::Blank);
        page.strokes.push(InkStroke {
            points: vec![0.0, 0.0, 127.0, 0.0],
            pressures: Vec::new(),
            width: 254.0,
            tool: InkTool::Highlighter,
            colour: InkColour::Yellow,
            t0: 0.0,
            shape: InkShape::None,
            line_index: -1.0,
        });
        let strokes = ink_strokes((0.0, 0.0), &page, "ink");
        assert_eq!(strokes[0].t, "highlighter");
        assert!(strokes[0].r.is_empty());
    }

    #[test]
    fn a_stroke_with_a_non_finite_point_is_dropped() {
        let mut page = blank_ink_page(InkPaper::Blank);
        page.strokes.push(InkStroke {
            points: vec![0.0, 0.0, f64::NAN, 127.0],
            pressures: Vec::new(),
            width: 10.0,
            tool: InkTool::Pen,
            colour: InkColour::Text,
            t0: 0.0,
            shape: InkShape::None,
            line_index: -1.0,
        });
        assert!(ink_strokes((0.0, 0.0), &page, "ink").is_empty());
    }

    #[test]
    fn freeform_output_round_trips_through_the_canvas_reader() {
        let layout = [text(Some(127.0), Some(127.0), "typed"), image("image-1.png", None, None)];
        let files = BTreeMap::from([("image-1.png".to_owned(), "attachments/a.png".to_owned())]);
        let strokes = [stroke("s1", vec![10, 20, 30, 40])];
        let once = freeform_canvas(&layout, &files, &strokes);
        let canvas = parsed(&once);
        assert_eq!(canvas_text(&canvas), once);
        assert_eq!(read_ink(&canvas), strokes.to_vec());
    }

    #[test]
    fn colour_hex_is_the_palette_value() {
        assert_eq!(colour_hex(InkColour::Grey), "#6b7280");
        assert_eq!(colour_hex(InkColour::Blue), "#2563eb");
    }
}
