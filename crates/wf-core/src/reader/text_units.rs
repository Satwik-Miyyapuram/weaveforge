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

// No TS test on main for this module; cases come from the doc comments.
#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    #[test]
    fn as_f64_counts_as_a_float() {
        assert_eq!(as_f64(3), 3.0);
    }

    #[test]
    fn utf16_slice_takes_the_half_open_range() {
        assert_eq!(utf16_slice("hello", 1.0, 3.0), "el");
        assert_eq!(utf16_slice("abc", 2.0, 2.0), "");
        assert_eq!(utf16_slice("abc", 2.0, 1.0), "");
    }

    #[test]
    fn utf16_slice_clamps_bounds_and_reads_nan_as_zero() {
        assert_eq!(utf16_slice("abc", -5.0, 100.0), "abc");
        assert_eq!(utf16_slice("abc", f64::NAN, 2.0), "ab");
    }

    #[test]
    fn utf16_slice_counts_an_astral_character_as_two_units() {
        // "a" is one unit, the emoji two, "b" one.
        assert_eq!(utf16_slice("a\u{1F600}b", 0.0, 3.0), "a\u{1F600}");
        assert_eq!(utf16_slice("a\u{1F600}b", 3.0, 4.0), "b");
    }

    #[test]
    fn is_js_space_includes_the_byte_order_mark() {
        assert!(is_js_space(' '));
        assert!(is_js_space('\u{FEFF}'));
        assert!(!is_js_space('x'));
    }

    #[test]
    fn collapse_whitespace_trims_and_joins_runs_with_one_space() {
        assert_eq!(collapse_whitespace("  a \n\t b  "), "a b");
        assert_eq!(collapse_whitespace("   "), "");
        assert_eq!(collapse_whitespace(""), "");
    }
}
