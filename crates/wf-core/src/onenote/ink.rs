//! OneNote ink to WeaveForge ink pages: placement, colour, tool and page splitting.

use onenote_parser::contents::InkStroke as ParsedStroke;
use onenote_parser::contents::{Content, EmbeddedObject, Ink, Outline, OutlineItem};
use onenote_parser::page::{Page, PageContent};

use crate::ink::ink_page::{
    INK_A4_HEIGHT, INK_A4_WIDTH, INK_COORD_LIMIT, INK_PAGE_STROKE_BUDGET, InkColour, InkPage,
    InkStroke, InkStrokeInput, InkTool, clamp_ink_page_size, make_ink_stroke,
};
use crate::sync::ink_note::InkPaper;

/// Half an inch in 0.1 mm, the unit of OneNote offsets.
const HALF_INCH_TENTHS_MM: f64 = 127.0;
/// Margin kept when a page's ink would start at a negative coordinate, in 0.1 mm.
const MARGIN: f64 = 50.0;
/// Extra room added past the furthest point when sizing a page, in 0.1 mm.
const PAGE_PAD: f64 = 100.0;

/// Palette a OneNote stroke colour snaps to, as RGB.
const PALETTE: [(InkColour, (i64, i64, i64)); 9] = [
    (InkColour::Text, (0, 0, 0)),
    (InkColour::Red, (220, 38, 38)),
    (InkColour::Green, (22, 163, 74)),
    (InkColour::Blue, (37, 99, 235)),
    (InkColour::Yellow, (234, 179, 8)),
    (InkColour::Purple, (147, 51, 234)),
    (InkColour::Pink, (219, 39, 119)),
    (InkColour::Orange, (234, 88, 12)),
    (InkColour::Grey, (107, 114, 128)),
];

/// A stroke in page coordinates before it becomes an `InkStroke`.
#[derive(Debug, Clone)]
struct RawStroke {
    points: Vec<(f64, f64)>,
    width: f64,
    tool: InkTool,
    colour: InkColour,
}

/// Ink pages for every ink object on `page`, or empty when it has none.
pub(crate) fn page_ink(page: &Page) -> Vec<InkPage> {
    let mut raw = Vec::new();
    for content in page.contents() {
        match content {
            PageContent::Ink(ink) => collect_ink(ink, (0.0, 0.0), &mut raw),
            PageContent::Outline(outline) => collect_outline(outline, &mut raw),
            _ => {}
        }
    }
    build_pages(&raw)
}

fn collect_outline(outline: &Outline, out: &mut Vec<RawStroke>) {
    let origin = resolve_origin(
        outline.offset_horizontal(),
        outline.offset_vertical(),
        (0.0, 0.0),
    );
    collect_items(outline.items(), origin, out);
}

fn collect_items(items: &[OutlineItem], origin: (f64, f64), out: &mut Vec<RawStroke>) {
    for item in items {
        match item {
            OutlineItem::Group(group) => collect_items(group.outlines(), origin, out),
            OutlineItem::Element(element) => {
                for content in element.contents() {
                    match content {
                        Content::Ink(ink) => collect_ink(ink, origin, out),
                        Content::RichText(rich) => {
                            for object in rich.embedded_objects() {
                                if let EmbeddedObject::Ink(container) = object {
                                    collect_ink(container.ink(), origin, out);
                                }
                            }
                        }
                        _ => {}
                    }
                }
                collect_items(element.children(), origin, out);
            }
        }
    }
}

/// Appends the strokes of `ink` and its child groups; `fallback` is the enclosing origin.
fn collect_ink(ink: &Ink, fallback: (f64, f64), out: &mut Vec<RawStroke>) {
    let origin = resolve_origin(ink.offset_horizontal(), ink.offset_vertical(), fallback);
    let bbox_min = ink.bounding_box().map_or((0.0, 0.0), |bbox| {
        (f64::from(bbox.x()), f64::from(bbox.y()))
    });
    for stroke in ink.ink_strokes() {
        out.push(raw_stroke(stroke, origin, bbox_min));
    }
    for child in ink.child_groups() {
        collect_ink(child, origin, out);
    }
}

fn raw_stroke(stroke: &ParsedStroke, origin: (f64, f64), bbox_min: (f64, f64)) -> RawStroke {
    let points: Vec<(f64, f64)> = stroke
        .absolute_path()
        .iter()
        .map(|point| (f64::from(point.x()), f64::from(point.y())))
        .collect();
    let tool = match stroke.transparency() {
        Some(alpha) if alpha < 255 => InkTool::Highlighter,
        _ => InkTool::Pen,
    };
    let colour = stroke.color().map_or(InkColour::Text, |colorref| {
        nearest_colour(colorref_rgb(colorref))
    });
    RawStroke {
        points: place_points(&points, origin, bbox_min),
        width: f64::from(stroke.width()) / 10.0,
        tool,
        colour,
    }
}

/// Origin from per-axis half-inch offsets, using `fallback` for any axis without one.
fn resolve_origin(
    horizontal: Option<f32>,
    vertical: Option<f32>,
    fallback: (f64, f64),
) -> (f64, f64) {
    (
        horizontal.map_or(fallback.0, |h| f64::from(h) * HALF_INCH_TENTHS_MM),
        vertical.map_or(fallback.1, |v| f64::from(v) * HALF_INCH_TENTHS_MM),
    )
}

/// Maps ink-unit points (0.01 mm) to page units (0.1 mm): `origin + (p - bbox_min) / 10`.
pub(crate) fn place_points(
    points: &[(f64, f64)],
    origin: (f64, f64),
    bbox_min: (f64, f64),
) -> Vec<(f64, f64)> {
    points
        .iter()
        .map(|&(x, y)| {
            (
                origin.0 + (x - bbox_min.0) / 10.0,
                origin.1 + (y - bbox_min.1) / 10.0,
            )
        })
        .collect()
}

/// Shifts paths so no coordinate is negative (to a 5 mm margin), then rounds and clamps.
pub(crate) fn fit_to_page(paths: &mut [Vec<(f64, f64)>]) {
    let min_x = paths
        .iter()
        .flatten()
        .map(|p| p.0)
        .fold(f64::INFINITY, f64::min);
    let min_y = paths
        .iter()
        .flatten()
        .map(|p| p.1)
        .fold(f64::INFINITY, f64::min);
    let dx = if min_x < 0.0 { MARGIN - min_x } else { 0.0 };
    let dy = if min_y < 0.0 { MARGIN - min_y } else { 0.0 };
    let limit = f64::from(INK_COORD_LIMIT);
    for point in paths.iter_mut().flatten() {
        point.0 = whole_coord(point.0 + dx, limit);
        point.1 = whole_coord(point.1 + dy, limit);
    }
}

fn whole_coord(value: f64, limit: f64) -> f64 {
    if value.is_finite() {
        value.round().clamp(0.0, limit)
    } else {
        0.0
    }
}

fn build_pages(raw: &[RawStroke]) -> Vec<InkPage> {
    if raw.is_empty() {
        return Vec::new();
    }
    let mut paths: Vec<Vec<(f64, f64)>> = raw.iter().map(|stroke| stroke.points.clone()).collect();
    fit_to_page(&mut paths);
    let max_x = paths.iter().flatten().map(|p| p.0).fold(0.0, f64::max);
    let max_y = paths.iter().flatten().map(|p| p.1).fold(0.0, f64::max);
    let size = clamp_ink_page_size(
        (max_x + PAGE_PAD).max(INK_A4_WIDTH),
        (max_y + PAGE_PAD).max(INK_A4_HEIGHT),
    );

    let strokes: Vec<InkStroke> = raw
        .iter()
        .zip(paths.iter())
        .enumerate()
        .filter(|(_, (_, path))| !path.is_empty())
        .map(|(index, (stroke, path))| {
            make_ink_stroke(InkStrokeInput {
                points: path.iter().flat_map(|&(x, y)| [x, y]).collect(),
                width: Some(stroke.width),
                tool: Some(stroke.tool),
                colour: Some(stroke.colour),
                t0: Some(index_as_f64(index) * 10.0),
                ..Default::default()
            })
        })
        .collect();

    strokes
        .chunks(INK_PAGE_STROKE_BUDGET)
        .map(|chunk| InkPage {
            width: size.width,
            height: size.height,
            paper: InkPaper::Blank,
            background: 0.0,
            strokes: chunk.to_vec(),
            lines: Vec::new(),
        })
        .collect()
}

fn index_as_f64(index: usize) -> f64 {
    f64::from(u32::try_from(index).unwrap_or(u32::MAX))
}

/// Splits a COLORREF (`0x00BBGGRR`) into `(r, g, b)`.
fn colorref_rgb(colorref: u32) -> (i64, i64, i64) {
    (
        i64::from(colorref & 0xff),
        i64::from((colorref >> 8) & 0xff),
        i64::from((colorref >> 16) & 0xff),
    )
}

/// Nearest palette colour to `rgb` by squared RGB distance.
pub(crate) fn nearest_colour(rgb: (i64, i64, i64)) -> InkColour {
    let mut best = InkColour::Text;
    let mut best_distance = i64::MAX;
    for (colour, (r, g, b)) in PALETTE {
        let distance = (rgb.0 - r).pow(2) + (rgb.1 - g).pow(2) + (rgb.2 - b).pow(2);
        if distance < best_distance {
            best_distance = distance;
            best = colour;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nearest_colour_snaps_colorref_to_palette() {
        assert_eq!(nearest_colour(colorref_rgb(0x000000)), InkColour::Text);
        assert_eq!(nearest_colour(colorref_rgb(0x0000FF)), InkColour::Red);
        assert_eq!(nearest_colour(colorref_rgb(0xFF0000)), InkColour::Blue);
        assert_eq!(nearest_colour(colorref_rgb(0x00FFFF)), InkColour::Yellow);
    }

    #[test]
    fn fit_shifts_negative_points_to_margin() {
        let mut paths = vec![vec![(-10.0, -20.0), (5.0, 5.0)]];
        fit_to_page(&mut paths);
        let min_x = paths[0].iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
        let min_y = paths[0].iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
        assert!((min_x - MARGIN).abs() < f64::EPSILON);
        assert!((min_y - MARGIN).abs() < f64::EPSILON);
    }

    #[test]
    fn fit_clamps_huge_points_to_coord_limit() {
        let mut paths = vec![vec![(1.0e9, 0.0)]];
        fit_to_page(&mut paths);
        assert!((paths[0][0].0 - f64::from(INK_COORD_LIMIT)).abs() < f64::EPSILON);
    }

    #[test]
    fn place_points_applies_origin_and_bbox() {
        let placed = place_points(&[(100.0, 200.0)], (10.0, 20.0), (50.0, 100.0));
        assert_eq!(placed, vec![(15.0, 30.0)]);
    }
}
