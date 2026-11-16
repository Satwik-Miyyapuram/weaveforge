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
pub(crate) const HALF_INCH_TENTHS_MM: f64 = 127.0;
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
pub(crate) struct RawStroke {
    points: Vec<(f64, f64)>,
    width: f64,
    tool: InkTool,
    colour: InkColour,
}

/// A rectangle on the OneNote page or on an ink page, in 0.1 mm.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Rect {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

/// One ink page made from a OneNote page.
#[derive(Debug, Clone)]
pub(crate) struct Sheet {
    pub(crate) page: InkPage,
    /// Where the band's printout image sits on this ink page.
    pub(crate) background: Option<Rect>,
    /// Index of the band this sheet belongs to.
    pub(crate) group: usize,
    /// Page position of this sheet's corner, in 0.1 mm: a sheet point plus
    /// the origin is the same point on the OneNote page.
    pub(crate) origin_x: f64,
    pub(crate) origin_y: f64,
}

/// Every ink stroke on `page`, in OneNote page coordinates.
pub(crate) fn page_strokes(page: &Page) -> Vec<RawStroke> {
    let mut raw = Vec::new();
    for content in page.contents() {
        match content {
            PageContent::Ink(ink) => collect_ink(ink, (0.0, 0.0), &mut raw),
            PageContent::Outline(outline) => collect_outline(outline, &mut raw),
            _ => {}
        }
    }
    raw
}

/// Band holding `y`: the last band whose top is at or above it, else the first.
pub(crate) fn band_index(tops: &[f64], y: f64) -> usize {
    tops.iter().rposition(|&top| top <= y).unwrap_or(0)
}

/// Ink pages for `raw`. With `bands` (printout pages, sorted by top) each band
/// gets its own pages holding the strokes whose middle falls in it, shifted so
/// the band's corner is the page corner (or further, for ink in the margin).
/// Every sheet gets the largest sheet's size. Without bands every stroke
/// shares one page size.
pub(crate) fn build_sheets(raw: &[RawStroke], bands: &[Rect]) -> Vec<Sheet> {
    if bands.is_empty() {
        let paths: Vec<Vec<(f64, f64)>> = raw.iter().map(|stroke| stroke.points.clone()).collect();
        let (dx, dy) = fit_shift(&paths);
        return build_pages(raw)
            .into_iter()
            .map(|page| Sheet {
                page,
                background: None,
                group: 0,
                origin_x: -dx,
                origin_y: -dy,
            })
            .collect();
    }
    let tops: Vec<f64> = bands.iter().map(|band| band.y).collect();
    let mut members: Vec<Vec<usize>> = vec![Vec::new(); bands.len()];
    for (index, stroke) in raw.iter().enumerate() {
        if let Some((_, min_y, _, max_y)) = bounds(stroke.points.iter()) {
            members[band_index(&tops, (min_y + max_y) / 2.0)].push(index);
        }
    }

    let mut sheets = Vec::new();
    for (group, (band, indices)) in bands.iter().zip(&members).enumerate() {
        band_sheets(raw, band, indices, group, &mut sheets);
    }
    // The ink view lays every page of a note out at one size, so all sheets
    // take the largest; content is anchored top-left and does not move.
    let width = sheets.iter().map(|s| s.page.width).fold(0.0, f64::max);
    let height = sheets.iter().map(|s| s.page.height).fold(0.0, f64::max);
    for sheet in &mut sheets {
        sheet.page.width = width;
        sheet.page.height = height;
    }
    sheets
}

/// Sheets for one printout `band` holding the strokes at `indices`.
fn band_sheets(
    raw: &[RawStroke],
    band: &Rect,
    indices: &[usize],
    group: usize,
    sheets: &mut Vec<Sheet>,
) {
    let limit = f64::from(INK_COORD_LIMIT);
    {
        let extent = bounds(indices.iter().flat_map(|&i| raw[i].points.iter()));
        let (ox, oy) = extent.map_or((band.x, band.y), |(min_x, min_y, _, _)| {
            (band.x.min(min_x - MARGIN), band.y.min(min_y - MARGIN))
        });
        let placed = Rect {
            x: band.x - ox,
            y: band.y - oy,
            width: band.width,
            height: band.height,
        };
        let (mut right, mut bottom) = (placed.x + placed.width, placed.y + placed.height);
        if let Some((_, _, max_x, max_y)) = extent {
            right = right.max(max_x - ox + PAGE_PAD);
            bottom = bottom.max(max_y - oy + PAGE_PAD);
        }
        let size = clamp_ink_page_size(right, bottom);
        let strokes: Vec<InkStroke> = indices
            .iter()
            .map(|&index| {
                let stroke = &raw[index];
                let points = stroke
                    .points
                    .iter()
                    .flat_map(|&(x, y)| [whole_coord(x - ox, limit), whole_coord(y - oy, limit)])
                    .collect();
                ink_stroke(stroke, points, index)
            })
            .collect();
        let sheet = |strokes: Vec<InkStroke>| Sheet {
            page: InkPage {
                width: size.width,
                height: size.height,
                paper: InkPaper::Blank,
                background: 0.0,
                strokes,
                lines: Vec::new(),
            },
            background: Some(placed),
            group,
            origin_x: ox,
            origin_y: oy,
        };
        if strokes.is_empty() {
            sheets.push(sheet(Vec::new()));
        } else {
            sheets.extend(
                strokes
                    .chunks(INK_PAGE_STROKE_BUDGET)
                    .map(|chunk| sheet(chunk.to_vec())),
            );
        }
    }
}

/// `(min_x, min_y, max_x, max_y)` of `points`, or `None` when there are none.
fn bounds<'a>(points: impl Iterator<Item = &'a (f64, f64)>) -> Option<(f64, f64, f64, f64)> {
    points.fold(None, |acc, &(x, y)| {
        Some(acc.map_or((x, y, x, y), |(a, b, c, d)| {
            (a.min(x), b.min(y), c.max(x), d.max(y))
        }))
    })
}

fn ink_stroke(stroke: &RawStroke, points: Vec<f64>, index: usize) -> InkStroke {
    make_ink_stroke(InkStrokeInput {
        points,
        width: Some(stroke.width),
        tool: Some(stroke.tool),
        colour: Some(stroke.colour),
        t0: Some(index_as_f64(index) * 10.0),
        ..Default::default()
    })
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

/// The shift `fit_to_page` applies: enough to lift any negative coordinate to the margin.
fn fit_shift(paths: &[Vec<(f64, f64)>]) -> (f64, f64) {
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
    (dx, dy)
}

/// Shifts paths so no coordinate is negative (to a 5 mm margin), then rounds and clamps.
pub(crate) fn fit_to_page(paths: &mut [Vec<(f64, f64)>]) {
    let (dx, dy) = fit_shift(paths);
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
            ink_stroke(
                stroke,
                path.iter().flat_map(|&(x, y)| [x, y]).collect(),
                index,
            )
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

    fn stroke(points: &[(f64, f64)]) -> RawStroke {
        RawStroke {
            points: points.to_vec(),
            width: 1.0,
            tool: InkTool::Pen,
            colour: InkColour::Text,
        }
    }

    fn a4_at(y: f64) -> Rect {
        Rect {
            x: 127.0,
            y,
            width: 2100.0,
            height: 2970.0,
        }
    }

    #[test]
    fn band_index_picks_last_band_at_or_above() {
        let tops = [0.0, 3000.0, 6000.0];
        assert_eq!(band_index(&tops, -50.0), 0);
        assert_eq!(band_index(&tops, 2999.0), 0);
        assert_eq!(band_index(&tops, 3000.0), 1);
        assert_eq!(band_index(&tops, 9000.0), 2);
        assert_eq!(band_index(&[], 10.0), 0);
    }

    #[test]
    fn sheets_without_bands_match_old_pages() {
        let raw = vec![stroke(&[(10.0, 10.0), (20.0, 20.0)])];
        let sheets = build_sheets(&raw, &[]);
        assert_eq!(sheets.len(), 1);
        assert_eq!(sheets[0].background, None);
        assert_eq!(sheets[0].page, build_pages(&raw)[0]);
    }

    #[test]
    fn strokes_go_to_their_band_and_shift_to_its_corner() {
        let bands = [a4_at(127.0), a4_at(3200.0)];
        let raw = vec![
            stroke(&[(500.0, 400.0), (600.0, 500.0)]),
            stroke(&[(500.0, 3500.0), (600.0, 3600.0)]),
        ];
        let sheets = build_sheets(&raw, &bands);
        assert_eq!(sheets.len(), 2);
        assert_eq!((sheets[0].group, sheets[1].group), (0, 1));
        assert_eq!(sheets[0].page.strokes.len(), 1);
        assert_eq!(sheets[1].page.strokes.len(), 1);
        let image = sheets[1].background.unwrap();
        assert_eq!(
            (image.x, image.y, image.width, image.height),
            (0.0, 0.0, 2100.0, 2970.0)
        );
        assert_eq!(&sheets[1].page.strokes[0].points[..2], &[373.0, 300.0]);
        assert!((sheets[1].page.width - 2100.0).abs() < f64::EPSILON);
        assert!((sheets[1].page.height - 2970.0).abs() < f64::EPSILON);
    }

    #[test]
    fn band_sheet_origin_is_where_its_page_corner_sits_on_the_page() {
        // origin + sheet point = page point, so a sheet's origin is its page
        // position: the band corner, or further out for ink in the margin.
        let bands = [a4_at(127.0), a4_at(3200.0)];
        let raw = vec![
            stroke(&[(500.0, 400.0), (600.0, 500.0)]),
            stroke(&[(500.0, 3500.0), (600.0, 3600.0)]),
        ];
        let sheets = build_sheets(&raw, &bands);
        assert_eq!((sheets[0].origin_x, sheets[0].origin_y), (127.0, 127.0));
        assert_eq!((sheets[1].origin_x, sheets[1].origin_y), (127.0, 3200.0));
        let margin = build_sheets(
            &[stroke(&[(27.0, 500.0), (3000.0, 600.0)])],
            &[a4_at(127.0)],
        );
        assert_eq!((margin[0].origin_x, margin[0].origin_y), (-23.0, 127.0));
    }

    #[test]
    fn band_less_origin_maps_sheet_points_back_to_page_points() {
        let raw = vec![stroke(&[(-10.0, -20.0), (5.0, 5.0)])];
        let sheets = build_sheets(&raw, &[]);
        let sheet = &sheets[0];
        assert_eq!((sheet.origin_x, sheet.origin_y), (-60.0, -70.0));
        let points = &sheet.page.strokes[0].points;
        assert_eq!(
            (points[0] + sheet.origin_x, points[1] + sheet.origin_y),
            (-10.0, -20.0)
        );

        let plain = build_sheets(&[stroke(&[(10.0, 10.0)])], &[]);
        assert_eq!((plain[0].origin_x, plain[0].origin_y), (0.0, 0.0));
    }

    #[test]
    fn margin_ink_widens_the_page_and_keeps_the_image_in_place() {
        let bands = [a4_at(127.0)];
        let raw = vec![stroke(&[(27.0, 500.0), (3000.0, 600.0)])];
        let sheets = build_sheets(&raw, &bands);
        let sheet = &sheets[0];
        let image = sheet.background.unwrap();
        assert!((image.x - 150.0).abs() < f64::EPSILON);
        assert!(image.y.abs() < f64::EPSILON);
        assert!((sheet.page.width - 3123.0).abs() < f64::EPSILON);
        assert_eq!(&sheet.page.strokes[0].points[..2], &[50.0, 373.0]);
    }

    #[test]
    fn every_sheet_takes_the_largest_page_size() {
        // The ink view sizes every page of a note alike, so a wide page
        // (margin ink) must not leave its neighbours narrower.
        let bands = [a4_at(127.0), a4_at(3200.0)];
        let raw = vec![
            stroke(&[(500.0, 400.0), (600.0, 500.0)]),
            stroke(&[(500.0, 3500.0), (4000.0, 3600.0)]),
        ];
        let sheets = build_sheets(&raw, &bands);
        assert_eq!(sheets.len(), 2);
        let (w, h) = (sheets[1].page.width, sheets[0].page.height);
        assert!(w > 2100.0);
        for sheet in &sheets {
            assert!((sheet.page.width - w).abs() < f64::EPSILON);
            assert!((sheet.page.height - h).abs() < f64::EPSILON);
        }
        // Content stays anchored top-left.
        let image = sheets[0].background.unwrap();
        assert_eq!((image.x, image.y), (0.0, 0.0));
        assert_eq!(&sheets[0].page.strokes[0].points[..2], &[373.0, 273.0]);
    }

    #[test]
    fn a_band_without_ink_still_makes_a_page() {
        let bands = [a4_at(127.0), a4_at(3200.0)];
        let raw = vec![stroke(&[(500.0, 400.0), (600.0, 500.0)])];
        let sheets = build_sheets(&raw, &bands);
        assert_eq!(sheets.len(), 2);
        assert!(sheets[1].page.strokes.is_empty());
        assert_eq!(sheets[1].group, 1);
    }

    #[test]
    fn a_full_band_splits_by_stroke_budget() {
        let bands = [a4_at(127.0)];
        let raw: Vec<RawStroke> = (0..=INK_PAGE_STROKE_BUDGET)
            .map(|_| stroke(&[(500.0, 400.0), (600.0, 500.0)]))
            .collect();
        let sheets = build_sheets(&raw, &bands);
        assert_eq!(sheets.len(), 2);
        assert!(
            sheets
                .iter()
                .all(|sheet| sheet.group == 0 && sheet.background.is_some())
        );
    }

    #[test]
    fn place_points_applies_origin_and_bbox() {
        let placed = place_points(&[(100.0, 200.0)], (10.0, 20.0), (50.0, 100.0));
        assert_eq!(placed, vec![(15.0, 30.0)]);
    }
}
