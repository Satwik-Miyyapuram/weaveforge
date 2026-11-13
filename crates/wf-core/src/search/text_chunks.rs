//! Port of packages/core/src/search/text-chunks.ts. Pure. Offsets are UTF-16 units, as in JS.

use crate::reader_analysis::lines::js_trim;
use crate::search::js_text::{is_js_whitespace, utf16_len};

/// Characters per passage (TS `DEFAULTS.maxChars`).
const DEFAULT_MAX_CHARS: f64 = 1_000.0;
/// Characters repeated between neighbours (TS `DEFAULTS.overlapChars`).
const DEFAULT_OVERLAP_CHARS: f64 = 120.0;
/// Below this a trailing fragment is merged back (TS `DEFAULTS.minChars`).
const DEFAULT_MIN_CHARS: f64 = 80.0;

/// UTF-16 unit for `\n`.
const NEWLINE: u16 = 0x0A;
/// UTF-16 unit for `.`.
const DOT: u16 = 0x2E;
/// UTF-16 unit for `!`.
const BANG: u16 = 0x21;
/// UTF-16 unit for `?`.
const QUESTION: u16 = 0x3F;

/// A boundary scan: the end of the first match starting at or after a position.
type ScanFn = fn(&[u16], usize) -> Option<usize>;

/// Options for [`chunk_for_embedding`]; unset fields take the TS defaults.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ChunkOptions {
    /// Characters per passage. Roughly four per token, so 1 000 sits under the 256-token window.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub max_chars: Option<f64>,
    /// Characters repeated between neighbours, so a sentence spanning a boundary lands whole.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub overlap_chars: Option<f64>,
    /// Below this a trailing fragment is merged back rather than embedded alone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub min_chars: Option<f64>,
}

/// One passage of a document (TS `TextChunk`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct TextChunk {
    /// The passage, trimmed.
    pub text: String,
    /// UTF-16 offset in the trimmed source, so a hit can point at the passage it matched.
    pub start: f64,
    /// UTF-16 offset just past the passage in the trimmed source.
    pub end: f64,
}

/// Split text into overlapping passages (TS `chunkForEmbedding`).
///
/// Text short enough to fit is returned as one chunk. Offsets index the trimmed text.
#[must_use]
pub fn chunk_for_embedding(text: &str, options: &ChunkOptions) -> Vec<TextChunk> {
    let max_chars = options.max_chars.unwrap_or(DEFAULT_MAX_CHARS);
    let overlap_chars = units(options.overlap_chars.unwrap_or(DEFAULT_OVERLAP_CHARS));
    let min_chars = options.min_chars.unwrap_or(DEFAULT_MIN_CHARS);

    let trimmed = js_trim(text);
    if trimmed.is_empty() {
        return Vec::new();
    }
    let source: Vec<u16> = trimmed.encode_utf16().collect();
    if as_f64(source.len()) <= max_chars {
        return vec![TextChunk {
            text: trimmed.to_owned(),
            start: 0.0,
            end: as_f64(source.len()),
        }];
    }

    let mut chunks = split_passages(&source, units(max_chars), overlap_chars, min_chars);
    fold_trailing(&mut chunks, min_chars);
    chunks
}

/// Cut `source` into passages, each ending at a boundary where one exists.
fn split_passages(source: &[u16], max: usize, overlap: usize, min_chars: f64) -> Vec<TextChunk> {
    let n = source.len();
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < n {
        let hard_end = (start + max).min(n);
        let cut = if hard_end == n {
            hard_end
        } else {
            boundary_before(source, start, hard_end, min_chars).unwrap_or(hard_end)
        };
        let raw = String::from_utf16_lossy(&source[start..cut]);
        let piece = js_trim(&raw);
        if !piece.is_empty() {
            chunks.push(TextChunk {
                text: piece.to_owned(),
                start: as_f64(start),
                end: as_f64(cut),
            });
        }
        if cut >= n {
            break;
        }
        // Step back by the overlap, but always move forward so text with no boundaries ends.
        start = cut.saturating_sub(overlap).max(start + 1);
    }
    chunks
}

/// Last structural boundary after `from` and at or before `limit` that leaves a passage worth
/// embedding. Blank lines first, then sentences, then whitespace (TS `boundaryBefore`).
fn boundary_before(source: &[u16], from: usize, limit: usize, min_chars: f64) -> Option<usize> {
    let scans: [ScanFn; 3] = [blank_line_end, sentence_end, space_end];
    for scan in scans {
        let best = last_end_within(source, from, limit, scan);
        if let Some(end) = best.filter(|&end| as_f64(end) > as_f64(from) + min_chars) {
            return Some(end);
        }
    }
    None
}

/// Largest match end at or before `limit`, taking matches from `from` in order.
fn last_end_within(source: &[u16], from: usize, limit: usize, scan: ScanFn) -> Option<usize> {
    let mut best = None;
    let mut pos = from;
    while let Some(end) = scan(source, pos) {
        if end > limit {
            break;
        }
        best = Some(end);
        pos = end;
    }
    best
}

/// End of the first `\n\s*\n` at or after `from`. The greedy `\s*` backtracks to the last newline.
fn blank_line_end(source: &[u16], from: usize) -> Option<usize> {
    let mut i = from;
    while i < source.len() {
        if source[i] == NEWLINE {
            let mut run_end = i + 1;
            while run_end < source.len() && is_space_unit(source[run_end]) {
                run_end += 1;
            }
            if let Some(last_nl) = (i + 1..run_end).rev().find(|&q| source[q] == NEWLINE) {
                return Some(last_nl + 1);
            }
            i = run_end;
        } else {
            i += 1;
        }
    }
    None
}

/// End of the first whitespace after `.`, `!` or `?` at or after `from`.
fn sentence_end(source: &[u16], from: usize) -> Option<usize> {
    (from..source.len())
        .find(|&i| {
            i > 0 && is_space_unit(source[i]) && matches!(source[i - 1], DOT | BANG | QUESTION)
        })
        .map(|i| i + 1)
}

/// End of the first whitespace at or after `from`.
fn space_end(source: &[u16], from: usize) -> Option<usize> {
    (from..source.len())
        .find(|&i| is_space_unit(source[i]))
        .map(|i| i + 1)
}

/// A final scrap carries no meaning alone, so it folds into its neighbour.
fn fold_trailing(chunks: &mut Vec<TextChunk>, min_chars: f64) {
    let short_scrap = chunks
        .last()
        .is_some_and(|last| as_f64(utf16_len(&last.text)) < min_chars);
    if chunks.len() < 2 || !short_scrap {
        return;
    }
    let Some(last) = chunks.pop() else { return };
    let Some(previous) = chunks.last_mut() else {
        return;
    };
    previous.text = js_trim(&format!("{} {}", previous.text, last.text)).to_owned();
    previous.end = last.end;
}

/// JS whitespace for a UTF-16 unit. Surrogates are never whitespace.
fn is_space_unit(unit: u16) -> bool {
    char::from_u32(u32::from(unit)).is_some_and(is_js_whitespace)
}

/// Option value as a count of UTF-16 units: truncated and clamped, NaN reads as zero.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to a non-negative range first; NaN saturates to zero"
)]
fn units(value: f64) -> usize {
    value.clamp(0.0, 9.0e15) as usize
}

/// A count of UTF-16 units as a JS number.
#[allow(
    clippy::cast_precision_loss,
    reason = "offsets stay far below 2^53, where f64 is exact"
)]
fn as_f64(count: usize) -> f64 {
    count as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(max: f64, overlap: f64, min: f64) -> ChunkOptions {
        ChunkOptions {
            max_chars: Some(max),
            overlap_chars: Some(overlap),
            min_chars: Some(min),
        }
    }

    fn chunk(text: &str, start: f64, end: f64) -> TextChunk {
        TextChunk {
            text: text.to_owned(),
            start,
            end,
        }
    }

    #[test]
    fn empty_and_blank_text_give_no_chunks() {
        assert!(chunk_for_embedding("", &ChunkOptions::default()).is_empty());
        // U+FEFF is trimmed by JS `trim()`.
        assert!(chunk_for_embedding(" \u{FEFF} \n", &ChunkOptions::default()).is_empty());
    }

    #[test]
    fn short_text_is_one_trimmed_chunk_in_utf16_units() {
        // The emoji is two UTF-16 units, so the trimmed text is 8 long.
        assert_eq!(
            chunk_for_embedding("  hello \u{1F600}\n", &ChunkOptions::default()),
            vec![chunk("hello \u{1F600}", 0.0, 8.0)]
        );
    }

    #[test]
    fn blank_line_is_preferred_boundary() {
        assert_eq!(
            chunk_for_embedding("first para here.\n\nsecond para", &opts(20.0, 0.0, 5.0)),
            vec![
                chunk("first para here.", 0.0, 18.0),
                chunk("second para", 18.0, 29.0),
            ]
        );
    }

    #[test]
    fn overlap_repeats_text_between_neighbours() {
        assert_eq!(
            chunk_for_embedding("aaaa bbbb cccc dddd", &opts(10.0, 3.0, 2.0)),
            vec![
                chunk("aaaa bbbb", 0.0, 10.0),
                chunk("bb cccc", 7.0, 15.0),
                chunk("cc dddd", 12.0, 19.0),
            ]
        );
    }

    #[test]
    fn short_trailing_scrap_folds_into_previous_chunk() {
        assert_eq!(
            chunk_for_embedding("aaaa bbbb cccc d", &opts(10.0, 0.0, 8.0)),
            vec![chunk("aaaa bbbb cccc d", 0.0, 16.0)]
        );
    }
}
