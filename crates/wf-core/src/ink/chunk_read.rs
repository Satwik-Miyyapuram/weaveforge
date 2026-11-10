//! Reading a checked chunk body back as the model. A port of
//! `packages/core/src/ink/ink-chunk-read.ts`: the views stay in TS for the
//! renderer, and the expensive direction — names, absolute coordinates, real
//! numbers — is built here for segmentation, recognition, tests and `wf ink dump`.

use super::chunk::{InkChunkLayout, check_ink_chunk_body};
use super::ink_page::{
    InkColour, InkLineRecord, InkPage, InkShape, InkStroke, InkStrokeInput, InkTool,
    make_ink_stroke,
};
use super::width::INK_PEN_WIDTH;

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn i16_at(bytes: &[u8], at: usize) -> i16 {
    i16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// The tool stored as `index`; an unknown index reads as the pen.
fn tool_at(index: u8) -> InkTool {
    match index {
        1 => InkTool::Highlighter,
        2 => InkTool::Shape,
        _ => InkTool::Pen,
    }
}

/// The colour stored as `index`; an unknown index reads as the text colour.
fn colour_at(index: u8) -> InkColour {
    const COLOURS: [InkColour; 14] = [
        InkColour::Text,
        InkColour::Accent,
        InkColour::Warn,
        InkColour::Good,
        InkColour::Info,
        InkColour::Danger,
        InkColour::Yellow,
        InkColour::Red,
        InkColour::Green,
        InkColour::Blue,
        InkColour::Purple,
        InkColour::Pink,
        InkColour::Orange,
        InkColour::Grey,
    ];
    COLOURS
        .get(usize::from(index))
        .copied()
        .unwrap_or(InkColour::Text)
}

/// The shape stored as `index`; an unknown index reads as freehand.
fn shape_at(index: u8) -> InkShape {
    match index {
        1 => InkShape::Line,
        2 => InkShape::Rect,
        3 => InkShape::Ellipse,
        4 => InkShape::Arrow,
        _ => InkShape::None,
    }
}

/// Walk one stroke's points as absolute coordinates and raw `Int16` pressures, in
/// stroke order. The deltas add up in `f64` as JS numbers do, so nothing wraps here;
/// a caller that stores into `Int16` takes the wrap itself.
fn walk_stroke(
    body: &[u8],
    layout: &InkChunkLayout,
    index: usize,
    mut visit: impl FnMut(f64, f64, i16),
) {
    let at = |section: u32, size: usize| section as usize + index * size;
    let start = u32_at(body, at(layout.stroke_point_offset, 4)) as usize;
    let count = usize::from(u16_at(body, at(layout.stroke_point_count, 2)));
    let (mut x, mut y) = (0.0, 0.0);
    for i in 0..count {
        let cell = layout.points as usize + (start + i) * 6;
        let (dx, dy) = (
            f64::from(i16_at(body, cell)),
            f64::from(i16_at(body, cell + 2)),
        );
        (x, y) = if i == 0 { (dx, dy) } else { (x + dx, y + dy) };
        visit(x, y, i16_at(body, cell + 4));
    }
}

/// One stroke as the model holds it: absolute points, names, real numbers.
fn stroke_at(body: &[u8], layout: &InkChunkLayout, index: usize) -> InkStroke {
    let mut points = Vec::new();
    let mut pressures = Vec::new();
    walk_stroke(body, layout, index, |x, y, pressure| {
        points.push(x);
        points.push(y);
        // The pressure cell is an Int16 read into a byte, as `Uint8Array` stores it.
        pressures.push(f64::from(pressure as u8));
    });
    let at = |section: u32, size: usize| section as usize + index * size;
    let width = body[at(layout.stroke_width, 1)];
    make_ink_stroke(InkStrokeInput {
        points,
        pressures: Some(pressures),
        width: Some(if width == 0 {
            INK_PEN_WIDTH
        } else {
            f64::from(width)
        }),
        tool: Some(tool_at(body[at(layout.stroke_tool, 1)])),
        colour: Some(colour_at(body[at(layout.stroke_colour, 1)])),
        t0: Some(f64::from(u32_at(body, at(layout.stroke_t0, 4)))),
        shape: Some(shape_at(body[at(layout.stroke_shape, 1)])),
        line_index: Some(f64::from(i16_at(body, at(layout.stroke_line, 2)))),
    })
}

/// One line of recognised text as the model holds it.
fn line_at(body: &[u8], layout: &InkChunkLayout, index: usize) -> InkLineRecord {
    let at = |section: u32, size: usize| section as usize + index * size;
    let offset = u32_at(body, at(layout.line_text_offset, 4)) as usize;
    let length = usize::from(u16_at(body, at(layout.line_text_length, 2)));
    let texts = layout.texts as usize + offset;
    InkLineRecord {
        stroke_start: f64::from(u16_at(body, at(layout.line_stroke_start, 2))),
        stroke_count: f64::from(u16_at(body, at(layout.line_stroke_count, 2))),
        y_min: f64::from(i16_at(body, at(layout.line_y_min, 2))),
        y_max: f64::from(i16_at(body, at(layout.line_y_max, 2))),
        text: String::from_utf8_lossy(&body[texts..texts + length]).into_owned(),
        // 0-255 on disk, 0-1 in the model, so a correction's `1` survives exactly.
        confidence: f64::from(body[at(layout.line_confidence, 1)]) / 255.0,
    }
}

/// One stroke's points as `x, y, pressure` triples: absolute, in 0.1 mm, unwrapped. This is
/// the walk `chunkStrokePoints` makes on the views. An index past the last stroke is empty.
///
/// # Errors
///
/// Fails on a body whose tables do not add up, as [`check_ink_chunk_body`].
pub fn stroke_point_triples(body: &[u8], stroke_index: usize) -> Result<Vec<f64>, String> {
    let layout = check_ink_chunk_body(body)?.layout;
    let mut triples = Vec::new();
    if stroke_index < layout.stroke_count as usize {
        walk_stroke(body, &layout, stroke_index, |x, y, pressure| {
            triples.extend([x, y, f64::from(pressure)]);
        });
    }
    Ok(triples)
}

/// Every point of the page as `x, y, pressure` `Int16` triples, stroke after stroke. Each
/// coordinate wraps to `i16` as an `Int16Array` write does, which is what `chunkAbsolutePoints`
/// stores; the pressure is the cell as read, signed.
///
/// # Errors
///
/// Fails on a body whose tables do not add up, as [`check_ink_chunk_body`].
pub fn absolute_point_triples(body: &[u8]) -> Result<Vec<i16>, String> {
    let layout = check_ink_chunk_body(body)?.layout;
    let mut triples = Vec::new();
    for index in 0..layout.stroke_count as usize {
        walk_stroke(body, &layout, index, |x, y, pressure| {
            triples.extend([wrap_i16(x), wrap_i16(y), pressure]);
        });
    }
    Ok(triples)
}

/// `ToInt16` for a whole-number coordinate: the low 16 bits, read as two's complement.
fn wrap_i16(value: f64) -> i16 {
    (value as i64) as i16
}

/// Round-trip an uncompressed body back to the model it was packed from.
///
/// # Errors
///
/// Fails on a body whose tables do not add up, as [`check_ink_chunk_body`].
pub fn page_from_chunk_body(body: &[u8]) -> Result<InkPage, String> {
    let info = check_ink_chunk_body(body)?;
    let layout = info.layout;
    Ok(InkPage {
        width: f64::from(info.width),
        height: f64::from(info.height),
        paper: info.paper,
        background: f64::from(info.background),
        strokes: (0..layout.stroke_count as usize)
            .map(|index| stroke_at(body, &layout, index))
            .collect(),
        lines: (0..layout.line_count as usize)
            .map(|index| line_at(body, &layout, index))
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ink::chunk::encode_ink_chunk_body;
    use crate::ink::ink_page::blank_ink_page;
    use crate::sync::ink_note::InkPaper;

    #[test]
    fn a_page_round_trips_through_its_body() {
        let mut page = blank_ink_page(InkPaper::Ruled);
        page.background = 3.0;
        page.strokes.push(make_ink_stroke(InkStrokeInput {
            points: vec![10.0, 20.0, 15.0, 18.0, 40.0, 60.0],
            pressures: Some(vec![10.0, 90.0, 250.0]),
            width: Some(7.0),
            tool: Some(InkTool::Highlighter),
            colour: Some(InkColour::Blue),
            t0: Some(1234.0),
            shape: Some(InkShape::Arrow),
            line_index: Some(0.0),
        }));
        page.lines.push(InkLineRecord {
            stroke_start: 0.0,
            stroke_count: 1.0,
            y_min: 18.0,
            y_max: 60.0,
            text: "β ≤ 16".to_owned(),
            confidence: 1.0,
        });
        let body = encode_ink_chunk_body(&page).expect("encodes");
        assert_eq!(page_from_chunk_body(&body).expect("decodes"), page);
    }

    #[test]
    fn the_point_walks_agree_with_the_page() {
        let mut page = blank_ink_page(InkPaper::Ruled);
        page.strokes.push(make_ink_stroke(InkStrokeInput {
            points: vec![10.0, 20.0, 15.0, 18.0, 40.0, 60.0],
            pressures: Some(vec![10.0, 90.0, 250.0]),
            width: Some(7.0),
            tool: Some(InkTool::Pen),
            colour: Some(InkColour::Text),
            t0: Some(0.0),
            shape: Some(InkShape::None),
            line_index: Some(0.0),
        }));
        let body = encode_ink_chunk_body(&page).expect("encodes");
        assert_eq!(
            stroke_point_triples(&body, 0).expect("walks"),
            vec![10.0, 20.0, 10.0, 15.0, 18.0, 90.0, 40.0, 60.0, 250.0],
        );
        assert!(stroke_point_triples(&body, 1).expect("walks").is_empty());
        assert_eq!(
            absolute_point_triples(&body).expect("walks"),
            vec![10_i16, 20, 10, 15, 18, 90, 40, 60, 250],
        );
    }

    #[test]
    fn a_corrupt_body_is_refused() {
        assert!(page_from_chunk_body(&[0_u8; 10]).is_err());
    }
}
