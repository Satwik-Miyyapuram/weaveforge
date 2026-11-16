//! The status bar's document numbers: word and character counts, reading time
//! and the cursor label. A port of
//! `apps/web/src/features/editor-workspace/application/document-stats.ts`.

use serde::{Deserialize, Serialize};

use crate::search::js_text::{is_js_whitespace, utf16_len};

/// Words and characters in a document body.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BodyStats {
    /// Runs of non-whitespace, as JS `split(/\s+/)` without empty tokens.
    pub words: u32,
    /// UTF-16 code units, as JS `String.length`.
    pub chars: u32,
}

/// Count words and characters over the whole body, frontmatter included.
#[must_use]
pub fn body_stats(body: &str) -> BodyStats {
    let words = body
        .split(is_js_whitespace)
        .filter(|token| !token.is_empty())
        .count();
    BodyStats {
        words: u32::try_from(words).unwrap_or(u32::MAX),
        chars: u32::try_from(utf16_len(body)).unwrap_or(u32::MAX),
    }
}

/// A count with thousands grouped by a thin space (U+2009), as
/// `toLocaleString("en-US")` with its commas swapped. Fractions keep at most
/// three digits.
#[must_use]
pub fn format_count(value: f64) -> String {
    if !value.is_finite() {
        return if value.is_nan() {
            "NaN".to_owned()
        } else if value > 0.0 {
            "∞".to_owned()
        } else {
            "-∞".to_owned()
        };
    }
    let fixed = format!("{:.3}", value.abs());
    let (whole, fraction) = fixed.split_once('.').unwrap_or((&fixed, ""));
    let fraction = fraction.trim_end_matches('0');
    let mut out = String::new();
    if value < 0.0 && (whole != "0" || !fraction.is_empty()) {
        out.push('-');
    }
    for (i, digit) in whole.chars().enumerate() {
        if i > 0 && (whole.len() - i) % 3 == 0 {
            out.push('\u{2009}');
        }
        out.push(digit);
    }
    if !fraction.is_empty() {
        out.push('.');
        out.push_str(fraction);
    }
    out
}

/// Average adult silent-reading speed, words per minute.
pub const WORDS_PER_MINUTE: u32 = 238;

/// The word segment: "1 word", "12 000 words · 51 min read"; no reading time at zero.
#[must_use]
pub fn format_words(words: u32) -> String {
    let unit = if words == 1 { "word" } else { "words" };
    let count = format!("{} {unit}", format_count(f64::from(words)));
    if words == 0 {
        return count;
    }
    format!("{count} · {} min read", words.div_ceil(WORDS_PER_MINUTE))
}

/// The cursor segment: "Ln 7, Col 4".
#[must_use]
pub fn format_cursor(line: u32, col: u32) -> String {
    format!("Ln {line}, Col {col}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whitespace_runs_do_not_make_words() {
        assert_eq!(body_stats(""), BodyStats { words: 0, chars: 0 });
        assert_eq!(
            body_stats("one two three"),
            BodyStats {
                words: 3,
                chars: 13
            }
        );
        assert_eq!(
            body_stats("  spaced \n\t out  "),
            BodyStats {
                words: 2,
                chars: 17
            }
        );
        assert_eq!(body_stats("a\u{00a0}b\u{feff}c").words, 3);
        assert_eq!(body_stats("😀").chars, 2);
    }

    #[test]
    fn counts_group_by_thin_space() {
        assert_eq!(format_count(9.0), "9");
        assert_eq!(format_count(1500.0), "1\u{2009}500");
        assert_eq!(format_count(1_234_567.0), "1\u{2009}234\u{2009}567");
        assert_eq!(format_count(-1500.5), "-1\u{2009}500.5");
        assert_eq!(format_count(0.12345), "0.123");
        assert_eq!(format_count(-0.0), "0");
    }

    #[test]
    fn words_add_a_reading_time() {
        assert_eq!(format_words(0), "0 words");
        assert_eq!(format_words(1), "1 word · 1 min read");
        assert_eq!(format_words(238), "238 words · 1 min read");
        assert_eq!(format_words(239), "239 words · 2 min read");
        assert_eq!(format_words(12_000), "12\u{2009}000 words · 51 min read");
        assert_eq!(format_cursor(7, 4), "Ln 7, Col 4");
    }
}
