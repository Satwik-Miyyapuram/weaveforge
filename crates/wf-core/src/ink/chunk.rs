//! The ink chunk container: one page, columnar binary (a port of
//! `packages/core/src/ink/ink-binary.ts`; its header has the layout table and
//! the size measurements).
//!
//! Here: the layout arithmetic, the 16-byte header, the strict body checks and
//! the body encoder. Building typed-array views over a decoded body stays in
//! TS, because a view over the caller's own buffer is what keeps opening a page
//! free of a parse, and so does the async compression around it.

use serde::Serialize;

use super::ink_page::{InkPage, clamp_ink_page_size};
use super::js_math::{max, min, round};
use super::pressure_byte;
use super::width::{INK_PEN_WIDTH, clamp_ink_note_width};
use crate::sync::ink_note::InkPaper;

/// Four bytes at the head of every chunk, so a foreign file is refused at once.
pub const INK_CHUNK_MAGIC: &[u8; 4] = b"WFIK";
/// Bumped when the layout changes; a version this code does not know is refused.
pub const INK_CHUNK_VERSION: u16 = 1;
/// Bit 0 of `flags`: the body is compressed and must be inflated first.
pub const INK_CHUNK_FLAG_COMPRESSED: u16 = 0x1;
/// The chunk header's length.
pub const INK_CHUNK_HEADER_BYTES: usize = 16;
/// Sidecar budget per note, hard.
pub const INK_NOTE_MAX_BYTES: f64 = 8.0 * 1024.0 * 1024.0;
/// Points one chunk may hold: 5 000 strokes at the 400-point cap, exactly.
pub const INK_CHUNK_MAX_POINTS: usize = 2_000_000;
/// Strokes one chunk may hold.
pub const INK_CHUNK_MAX_STROKES: usize = 65_535;

/// Four `u32` counts, then the 6-byte page header padded to 24.
const BODY_HEADER_BYTES: u64 = 24;

/// Where every section of a body starts, in bytes from the body's start.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkChunkLayout {
    /// Points in the page.
    pub point_count: u32,
    /// Strokes in the page.
    pub stroke_count: u32,
    /// Recognised lines.
    pub line_count: u32,
    /// Bytes of line text.
    pub text_bytes: u32,
    /// Offset of the `stroke_point_offset` section.
    pub stroke_point_offset: u32,
    /// Offset of the `stroke_point_count` section.
    pub stroke_point_count: u32,
    /// Offset of the `stroke_width` section.
    pub stroke_width: u32,
    /// Offset of the `stroke_tool` section.
    pub stroke_tool: u32,
    /// Offset of the `stroke_colour` section.
    pub stroke_colour: u32,
    /// Offset of the `stroke_shape` section.
    pub stroke_shape: u32,
    /// Offset of the `stroke_line` section.
    pub stroke_line: u32,
    /// Offset of the `stroke_t0` section.
    pub stroke_t0: u32,
    /// Offset of the `points` section.
    pub points: u32,
    /// Offset of the `line_stroke_start` section.
    pub line_stroke_start: u32,
    /// Offset of the `line_stroke_count` section.
    pub line_stroke_count: u32,
    /// Offset of the `line_y_min` section.
    pub line_y_min: u32,
    /// Offset of the `line_y_max` section.
    pub line_y_max: u32,
    /// Offset of the `line_text_offset` section.
    pub line_text_offset: u32,
    /// Offset of the `line_text_length` section.
    pub line_text_length: u32,
    /// Offset of the `line_confidence` section.
    pub line_confidence: u32,
    /// Offset of the `texts` section.
    pub texts: u32,
    /// The body's whole length.
    pub total: u32,
}

/// The chunk header, readable without inflating anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkChunkHeader {
    /// Format version.
    pub version: u16,
    /// Flag bits.
    pub flags: u16,
    /// Uncompressed body length.
    pub body_size: u32,
    /// Stored payload length.
    pub payload_size: u32,
    /// Total chunk length, so a caller can check a file before reading it all.
    pub total_bytes: u32,
    /// Whether the payload is compressed.
    pub compressed: bool,
}

/// A body that passed every check: its layout and its page header.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct InkChunkBodyInfo {
    /// Where each section starts.
    pub layout: InkChunkLayout,
    /// Page width in 0.1 mm.
    pub width: u16,
    /// Page height in 0.1 mm.
    pub height: u16,
    /// Page background.
    pub paper: InkPaper,
    /// Attachment index for a page image, 0 for none.
    pub background: u8,
}

/// Where every section starts, as plain arithmetic. Encode and decode both use
/// it, so a round trip is byte-identical.
///
/// # Errors
///
/// Fails when the body would not fit a `u32` length.
pub fn ink_chunk_layout(
    point_count: u32,
    stroke_count: u32,
    line_count: u32,
    text_bytes: u32,
) -> Result<InkChunkLayout, String> {
    let mut cursor = BODY_HEADER_BYTES;
    let mut take = |count: u64, size: u64| -> u64 {
        cursor = cursor.div_ceil(size) * size;
        let at = cursor;
        cursor += count * size;
        at
    };
    let strokes = u64::from(stroke_count);
    let lines = u64::from(line_count);
    let offsets = [
        take(strokes, 4),
        take(strokes, 2),
        take(strokes, 1),
        take(strokes, 1),
        take(strokes, 1),
        take(strokes, 1),
        take(strokes, 2),
        take(strokes, 4),
        take(u64::from(point_count) * 3, 2),
        take(lines, 2),
        take(lines, 2),
        take(lines, 2),
        take(lines, 2),
        take(lines, 4),
        take(lines, 2),
        take(lines, 1),
        take(u64::from(text_bytes), 1),
    ];
    let narrow = |value: u64| {
        u32::try_from(value).map_err(|_| "ink: chunk body is absurdly large".to_owned())
    };
    let total = narrow(cursor)?;
    // Every offset is below the total, so it fits too.
    let at = |index: usize| offsets[index] as u32;
    Ok(InkChunkLayout {
        point_count,
        stroke_count,
        line_count,
        text_bytes,
        stroke_point_offset: at(0),
        stroke_point_count: at(1),
        stroke_width: at(2),
        stroke_tool: at(3),
        stroke_colour: at(4),
        stroke_shape: at(5),
        stroke_line: at(6),
        stroke_t0: at(7),
        points: at(8),
        line_stroke_start: at(9),
        line_stroke_count: at(10),
        line_y_min: at(11),
        line_y_max: at(12),
        line_text_offset: at(13),
        line_text_length: at(14),
        line_confidence: at(15),
        texts: at(16),
        total,
    })
}

fn u16_at(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// Read the 16-byte header: size and compression flag without the inflate.
///
/// # Errors
///
/// Fails on a short buffer, a foreign magic, an unknown version or flag, or a
/// payload size that does not match the bytes.
pub fn read_ink_chunk_header(bytes: &[u8]) -> Result<InkChunkHeader, String> {
    if bytes.len() < INK_CHUNK_HEADER_BYTES {
        return Err(format!(
            "ink: chunk is {} bytes, shorter than its header",
            bytes.len()
        ));
    }
    if &bytes[..4] != INK_CHUNK_MAGIC {
        let magic: String = bytes[..4].iter().map(|&byte| char::from(byte)).collect();
        let quoted = serde_json::to_string(&magic).unwrap_or(magic);
        return Err(format!("ink: not an ink chunk (magic {quoted})"));
    }
    let version = u16_at(bytes, 4);
    if version != INK_CHUNK_VERSION {
        return Err(format!(
            "ink: chunk version {version}, this build reads {INK_CHUNK_VERSION}"
        ));
    }
    let flags = u16_at(bytes, 6);
    if flags & !INK_CHUNK_FLAG_COMPRESSED != 0 {
        return Err(format!("ink: unknown chunk flags 0x{flags:x}"));
    }
    let body_size = u32_at(bytes, 8);
    let payload_size = u32_at(bytes, 12);
    let carried = bytes.len() - INK_CHUNK_HEADER_BYTES;
    if u64::from(payload_size) != carried as u64 {
        return Err(format!(
            "ink: chunk claims {payload_size} payload bytes but carries {carried}"
        ));
    }
    let total_bytes =
        u32::try_from(bytes.len()).map_err(|_| "ink: chunk is absurdly large".to_owned())?;
    Ok(InkChunkHeader {
        version,
        flags,
        body_size,
        payload_size,
        total_bytes,
        compressed: flags & INK_CHUNK_FLAG_COMPRESSED != 0,
    })
}

/// The 16-byte header for a body of `body_size` bytes stored as `payload_size`.
#[must_use]
pub fn ink_chunk_header_bytes(body_size: u32, payload_size: u32, compressed: bool) -> Vec<u8> {
    let flags = if compressed {
        INK_CHUNK_FLAG_COMPRESSED
    } else {
        0
    };
    let mut header = Vec::with_capacity(INK_CHUNK_HEADER_BYTES);
    header.extend_from_slice(INK_CHUNK_MAGIC);
    header.extend_from_slice(&INK_CHUNK_VERSION.to_le_bytes());
    header.extend_from_slice(&flags.to_le_bytes());
    header.extend_from_slice(&body_size.to_le_bytes());
    header.extend_from_slice(&payload_size.to_le_bytes());
    header
}

/// Check an uncompressed body against its own tables. A chunk is untrusted
/// input, so every count, offset and length is checked before a view is taken.
///
/// # Errors
///
/// Fails on anything the body claims that its bytes do not support.
pub fn check_ink_chunk_body(body: &[u8]) -> Result<InkChunkBodyInfo, String> {
    if body.len() < 24 {
        return Err("ink: chunk body is shorter than its header".to_owned());
    }
    let point_count = u32_at(body, 0);
    let stroke_count = u32_at(body, 4);
    let line_count = u32_at(body, 8);
    let text_bytes = u32_at(body, 12);
    if stroke_count as usize > INK_CHUNK_MAX_STROKES {
        return Err(format!("ink: chunk claims {stroke_count} strokes"));
    }
    if point_count as usize > INK_CHUNK_MAX_POINTS {
        return Err(format!("ink: chunk claims {point_count} points"));
    }
    if line_count > stroke_count && line_count > 1 {
        return Err(format!(
            "ink: {line_count} lines for {stroke_count} strokes"
        ));
    }
    let layout = ink_chunk_layout(point_count, stroke_count, line_count, text_bytes)?;
    if layout.total as usize != body.len() {
        return Err(format!(
            "ink: chunk body is {} bytes, its tables say {}",
            body.len(),
            layout.total
        ));
    }

    // The stroke table must describe the point array exactly: contiguous
    // strokes, in order, ending at the last point.
    let mut expected: u64 = 0;
    for i in 0..stroke_count as usize {
        let offset = u32_at(body, layout.stroke_point_offset as usize + i * 4);
        if u64::from(offset) != expected {
            return Err(format!(
                "ink: stroke {i} starts at {offset}, expected {expected}"
            ));
        }
        expected += u64::from(u16_at(body, layout.stroke_point_count as usize + i * 2));
    }
    if expected != u64::from(point_count) {
        return Err(format!(
            "ink: strokes hold {expected} points, the header says {point_count}"
        ));
    }
    for i in 0..line_count as usize {
        let start = u32::from(u16_at(body, layout.line_stroke_start as usize + i * 2));
        let count = u32::from(u16_at(body, layout.line_stroke_count as usize + i * 2));
        if start + count > stroke_count {
            return Err(format!("ink: line {i} runs past the last stroke"));
        }
        let text_at = u64::from(u32_at(body, layout.line_text_offset as usize + i * 4));
        let text_len = u64::from(u16_at(body, layout.line_text_length as usize + i * 2));
        if text_at + text_len > u64::from(text_bytes) {
            return Err(format!("ink: line {i}'s text runs past the text blob"));
        }
    }

    Ok(InkChunkBodyInfo {
        layout,
        width: u16_at(body, 16),
        height: u16_at(body, 18),
        paper: paper_at(body[20]),
        background: body[21],
    })
}

/// The paper stored as `index`; an unknown index reads as blank.
fn paper_at(index: u8) -> InkPaper {
    match index {
        1 => InkPaper::Dotted,
        2 => InkPaper::Ruled,
        3 => InkPaper::Grid,
        4 => InkPaper::Wide,
        _ => InkPaper::Blank,
    }
}

/// A coordinate as `Int16`, rounded the JS way; non-finite is 0.
#[allow(clippy::cast_possible_truncation)] // clamped to the i16 range first
fn clamp_i16(value: f64) -> i16 {
    if value.is_finite() {
        max(-32_768.0, min(32_767.0, round(value))) as i16
    } else {
        0
    }
}

/// A count as `Uint16`, rounded the JS way; non-finite is 0.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)] // clamped to the u16 range first
fn clamp_u16(value: f64) -> u16 {
    if value.is_finite() {
        max(0.0, min(65_535.0, round(value))) as u16
    } else {
        0
    }
}

/// A value clamped into `0..=top` and rounded; NaN is 0, as a typed-array store makes it.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)] // clamped first; NaN casts to 0
fn clamp_unsigned(value: f64, top: f64) -> u64 {
    max(0.0, min(top, round(value))) as u64
}

/// The body length a page would take, without packing it.
///
/// # Errors
///
/// Fails when the body would not fit a `u32` length.
pub fn ink_chunk_body_size(page: &InkPage) -> Result<u32, String> {
    let points: usize = page
        .strokes
        .iter()
        .map(|stroke| stroke.points.len() / 2)
        .sum();
    let texts: usize = page.lines.iter().map(|line| line.text.len()).sum();
    let too_big = || "ink: chunk body is absurdly large".to_owned();
    let layout = ink_chunk_layout(
        u32::try_from(points).map_err(|_| too_big())?,
        u32::try_from(page.strokes.len()).map_err(|_| too_big())?,
        u32::try_from(page.lines.len()).map_err(|_| too_big())?,
        u32::try_from(texts).map_err(|_| too_big())?,
    )?;
    Ok(layout.total)
}

/// Whether chunks of these on-disk sizes still fit a note's budget.
#[must_use]
pub fn fits_ink_note_budget(sizes: &[f64]) -> bool {
    sizes.iter().sum::<f64>() <= INK_NOTE_MAX_BYTES
}

/// Pack a page into an uncompressed body. Refuses rather than truncates a page
/// the format cannot hold; widths, coordinates and texts are clamped.
///
/// # Errors
///
/// Fails on too many strokes or points, or a stroke over the `u16` length.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::too_many_lines
)] // casts are on clamped values; one pass over the layout
pub fn encode_ink_chunk_body(page: &InkPage) -> Result<Vec<u8>, String> {
    let strokes = &page.strokes;
    let lines = &page.lines;
    if strokes.len() > INK_CHUNK_MAX_STROKES {
        return Err(format!(
            "ink: {} strokes exceeds the {INK_CHUNK_MAX_STROKES} a chunk holds",
            strokes.len()
        ));
    }
    let point_counts: Vec<usize> = strokes
        .iter()
        .map(|stroke| stroke.points.len() / 2)
        .collect();
    let point_count: usize = point_counts.iter().sum();
    if point_count > INK_CHUNK_MAX_POINTS {
        return Err(format!(
            "ink: {point_count} points exceeds the {INK_CHUNK_MAX_POINTS} a chunk holds"
        ));
    }
    if let Some((index, count)) = point_counts
        .iter()
        .enumerate()
        .find(|(_, count)| **count > 65_535)
    {
        return Err(format!(
            "ink: stroke {index} has {count} points, over the u16 length"
        ));
    }
    let text_bytes: usize = lines.iter().map(|line| line.text.len()).sum();
    let text_bytes =
        u32::try_from(text_bytes).map_err(|_| "ink: text layer is absurdly large".to_owned())?;

    // The counts are under the caps checked above, so they fit a u32.
    let layout = ink_chunk_layout(
        point_count as u32,
        strokes.len() as u32,
        lines.len() as u32,
        text_bytes,
    )?;
    let mut body = vec![0_u8; layout.total as usize];
    let mut put = |at: u32, bytes: &[u8]| {
        let at = at as usize;
        body[at..at + bytes.len()].copy_from_slice(bytes);
    };

    let size = clamp_ink_page_size(page.width, page.height);
    put(0, &layout.point_count.to_le_bytes());
    put(4, &layout.stroke_count.to_le_bytes());
    put(8, &layout.line_count.to_le_bytes());
    put(12, &text_bytes.to_le_bytes());
    put(16, &(size.width as u16).to_le_bytes());
    put(18, &(size.height as u16).to_le_bytes());
    put(
        20,
        &[
            page.paper as u8,
            clamp_unsigned(page.background, 255.0) as u8,
        ],
    );

    let mut offset: u32 = 0;
    let mut cursor = layout.points;
    for (index, stroke) in strokes.iter().enumerate() {
        let count = point_counts[index];
        let i = index as u32;
        put(layout.stroke_point_offset + i * 4, &offset.to_le_bytes());
        put(
            layout.stroke_point_count + i * 2,
            &(count as u16).to_le_bytes(),
        );
        // Width is clamped, never rejected: refusing the stroke would lose the drawing.
        let width = min(255.0, clamp_ink_note_width(stroke.width, INK_PEN_WIDTH));
        put(layout.stroke_width + i, &[width as u8]);
        put(layout.stroke_tool + i, &[stroke.tool as u8]);
        put(layout.stroke_colour + i, &[stroke.colour as u8]);
        put(layout.stroke_shape + i, &[stroke.shape as u8]);
        put(
            layout.stroke_line + i * 2,
            &clamp_i16(stroke.line_index).to_le_bytes(),
        );
        put(
            layout.stroke_t0 + i * 4,
            &(clamp_unsigned(stroke.t0, f64::from(u32::MAX)) as u32).to_le_bytes(),
        );

        let (mut previous_x, mut previous_y) = (0_i16, 0_i16);
        for point in 0..count {
            let x = clamp_i16(stroke.points.get(point * 2).copied().unwrap_or(0.0));
            let y = clamp_i16(stroke.points.get(point * 2 + 1).copied().unwrap_or(0.0));
            // Every stroke's first point is absolute; a delta wraps as an Int16 store does.
            let (dx, dy) = if point == 0 {
                (x, y)
            } else {
                (x.wrapping_sub(previous_x), y.wrapping_sub(previous_y))
            };
            let pressure = pressure_byte(stroke.pressures.get(point).copied()) as i16;
            put(cursor, &dx.to_le_bytes());
            put(cursor + 2, &dy.to_le_bytes());
            put(cursor + 4, &pressure.to_le_bytes());
            previous_x = x;
            previous_y = y;
            cursor += 6;
        }
        offset += count as u32;
    }

    let mut text_cursor: u32 = 0;
    for (index, line) in lines.iter().enumerate() {
        let i = index as u32;
        put(
            layout.line_stroke_start + i * 2,
            &clamp_u16(line.stroke_start).to_le_bytes(),
        );
        put(
            layout.line_stroke_count + i * 2,
            &clamp_u16(line.stroke_count).to_le_bytes(),
        );
        put(
            layout.line_y_min + i * 2,
            &clamp_i16(line.y_min).to_le_bytes(),
        );
        put(
            layout.line_y_max + i * 2,
            &clamp_i16(line.y_max).to_le_bytes(),
        );
        put(layout.line_text_offset + i * 4, &text_cursor.to_le_bytes());
        // A text over u16 is clipped, and the clip is what is written, so the
        // offsets and the blob agree.
        let bytes = line.text.as_bytes();
        let length = bytes.len().min(0xffff);
        put(
            layout.line_text_length + i * 2,
            &(length as u16).to_le_bytes(),
        );
        // Confidence is 0-1 in the model and 0-255 on disk, so 1 stays exactly 1.
        let confidence = round(max(0.0, min(1.0, line.confidence)) * 255.0);
        put(
            layout.line_confidence + i,
            &[clamp_unsigned(confidence, 255.0) as u8],
        );
        put(layout.texts + text_cursor, &bytes[..length]);
        text_cursor += length as u32;
    }

    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ink::ink_page::{
        InkColour, InkLineRecord, InkShape, InkStroke, InkTool, blank_ink_page,
    };

    fn stroke(points: Vec<f64>) -> InkStroke {
        let pressures = vec![128.0; points.len() / 2];
        InkStroke {
            points,
            pressures,
            width: 20.0,
            tool: InkTool::Highlighter,
            colour: InkColour::Blue,
            t0: 1234.0,
            shape: InkShape::None,
            line_index: 0.0,
        }
    }

    fn page() -> InkPage {
        let mut page = blank_ink_page(InkPaper::Ruled);
        page.strokes = vec![
            stroke(vec![10.0, 20.0, 15.0, 18.0]),
            stroke(vec![-5.0, 7.0]),
        ];
        page.lines = vec![InkLineRecord {
            stroke_start: 0.0,
            stroke_count: 2.0,
            y_min: 7.0,
            y_max: 20.0,
            text: "héllo".to_owned(),
            confidence: 1.0,
        }];
        page
    }

    #[test]
    fn layout_aligns_every_section() {
        let layout = ink_chunk_layout(3, 2, 1, 6).unwrap();
        assert_eq!(layout.stroke_point_offset, 24);
        assert_eq!(layout.stroke_point_count, 32);
        assert_eq!(layout.stroke_width, 36);
        assert_eq!(layout.stroke_line, 44);
        assert_eq!(layout.stroke_t0, 48);
        assert_eq!(layout.points, 56);
        assert_eq!(layout.line_stroke_start, 74);
        assert_eq!(layout.line_text_offset, 84);
        assert_eq!(layout.texts, 91);
        assert_eq!(layout.total, 97);
        assert!(ink_chunk_layout(u32::MAX, 0, 0, u32::MAX).is_err());
    }

    #[test]
    fn encoded_body_checks_out() {
        let page = page();
        let body = encode_ink_chunk_body(&page).unwrap();
        assert_eq!(body.len() as u32, ink_chunk_body_size(&page).unwrap());
        let info = check_ink_chunk_body(&body).unwrap();
        assert_eq!(info.paper, InkPaper::Ruled);
        assert_eq!((info.width, info.height), (2100, 2970));
        let l = info.layout;
        assert_eq!(
            (l.point_count, l.stroke_count, l.line_count, l.text_bytes),
            (3, 2, 1, 6)
        );
        // Second point of stroke 0 is a delta; stroke 1 restarts absolute.
        let at = |i: usize| {
            i16::from_le_bytes([
                body[l.points as usize + i * 2],
                body[l.points as usize + i * 2 + 1],
            ])
        };
        assert_eq!(
            [at(0), at(1), at(2), at(3), at(4), at(5), at(6), at(7)],
            [10, 20, 128, 5, -2, 128, -5, 7]
        );
        assert_eq!(body[l.stroke_tool as usize], 1);
        assert_eq!(body[l.line_confidence as usize], 255);
        assert_eq!(&body[l.texts as usize..], "héllo".as_bytes());
    }

    #[test]
    fn corrupt_bodies_are_refused() {
        let body = encode_ink_chunk_body(&page()).unwrap();
        assert!(
            check_ink_chunk_body(&body[..20])
                .unwrap_err()
                .contains("shorter than its header")
        );
        assert!(
            check_ink_chunk_body(&body[..body.len() - 1])
                .unwrap_err()
                .contains("its tables say")
        );
        let mut gap = body.clone();
        let at = ink_chunk_layout(3, 2, 1, 6).unwrap().stroke_point_offset as usize + 4;
        gap[at] = 9;
        assert!(
            check_ink_chunk_body(&gap)
                .unwrap_err()
                .contains("stroke 1 starts at 9, expected 2")
        );
        let mut many = body;
        many[4..8].copy_from_slice(&70_000_u32.to_le_bytes());
        assert_eq!(
            check_ink_chunk_body(&many).unwrap_err(),
            "ink: chunk claims 70000 strokes"
        );
    }

    #[test]
    fn header_round_trips_and_refuses_foreign_bytes() {
        let mut chunk = ink_chunk_header_bytes(10, 4, true);
        chunk.extend_from_slice(&[1, 2, 3, 4]);
        let header = read_ink_chunk_header(&chunk).unwrap();
        assert_eq!(
            (header.body_size, header.payload_size, header.total_bytes),
            (10, 4, 20)
        );
        assert!(header.compressed);
        assert!(
            read_ink_chunk_header(&chunk[..8])
                .unwrap_err()
                .contains("shorter than its header")
        );
        assert!(
            read_ink_chunk_header(&chunk[..19])
                .unwrap_err()
                .contains("claims 4 payload bytes but carries 3")
        );
        let mut foreign = chunk.clone();
        foreign[0] = b'X';
        assert_eq!(
            read_ink_chunk_header(&foreign).unwrap_err(),
            "ink: not an ink chunk (magic \"XFIK\")"
        );
        let mut flagged = chunk;
        flagged[6] = 0x6;
        assert_eq!(
            read_ink_chunk_header(&flagged).unwrap_err(),
            "ink: unknown chunk flags 0x6"
        );
    }

    #[test]
    fn oversized_pages_are_refused_and_budget_sums() {
        let mut page = blank_ink_page(InkPaper::Blank);
        page.strokes = vec![stroke(vec![0.0; 65_536 * 2])];
        assert_eq!(
            encode_ink_chunk_body(&page).unwrap_err(),
            "ink: stroke 0 has 65536 points, over the u16 length"
        );
        assert!(fits_ink_note_budget(&[INK_NOTE_MAX_BYTES - 1.0, 1.0]));
        assert!(!fits_ink_note_budget(&[INK_NOTE_MAX_BYTES, 1.0]));
    }
}
