//! UTF-16 offset helpers for page text, matching JavaScript string indexing.
//!
//! Page offsets in the analysis count UTF-16 code units, so these helpers slice and measure in
//! those units rather than in UTF-8 bytes.

/// Count of a `usize` as the `f64` JS numbers use. Counts stay far below `u32::MAX`.
#[must_use]
pub fn as_f64(count: usize) -> f64 {
    f64::from(u32::try_from(count).unwrap_or(u32::MAX))
}

/// `text.slice(start, end)` on UTF-16 offsets. Bounds clamp to the text; `end <= start` gives `""`.
#[must_use]
pub fn utf16_slice(text: &str, start: f64, end: f64) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    let from = clamp_index(start, units.len());
    let to = clamp_index(end, units.len());
    if to <= from {
        return String::new();
    }
    String::from_utf16_lossy(&units[from..to])
}

/// Truncates a JS-style offset into `0..=len`. NaN reads as zero.
fn clamp_index(value: f64, len: usize) -> usize {
    if value.is_nan() {
        return 0;
    }
    let clamped = value.clamp(0.0, as_f64(len)).trunc();
    // The clamp bounds `clamped` to `0..=len`, so the cast is exact.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let index = clamped as usize;
    index
}

/// Characters JavaScript's `\s` matches: Unicode white space plus the byte-order mark.
#[must_use]
pub fn is_js_space(ch: char) -> bool {
    ch.is_whitespace() || ch == '\u{FEFF}'
}

/// JavaScript `text.replace(/\s+/g, " ").trim()`.
#[must_use]
pub fn collapse_whitespace(text: &str) -> String {
    text.split(is_js_space)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
