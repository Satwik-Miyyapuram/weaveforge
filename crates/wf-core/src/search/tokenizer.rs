//! Term normalization shared by indexing and querying: diacritic folding,
//! lowercasing and CJK detection. Port of `packages/core/src/search/search-tokenizer.ts`.

use std::ops::RangeInclusive;

use unicode_normalization::UnicodeNormalization;

/// Options for term normalization. Callers always pass them explicitly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenizerOptions {
    /// Fold é→e, ü→u. TS default: `true`.
    pub fold_diacritics: bool,
    /// Additionally strip Arabic harakat. TS default: `false`.
    pub fold_arabic_diacritics: bool,
    /// Emit `my`+`variable` alongside `myVariable`. TS default: `true`.
    pub split_camel_case: bool,
    /// Emit host and path segments of a URL as separate terms. TS default: `true`.
    pub tokenize_urls: bool,
}

/// Combining marks left behind by NFD normalization.
const COMBINING_MARKS: RangeInclusive<char> = '\u{300}'..='\u{36f}';

/// Arabic harakat. Separate because stripping them is not always wanted.
const ARABIC_MARKS: [RangeInclusive<char>; 5] = [
    '\u{64b}'..='\u{65f}',
    '\u{670}'..='\u{670}',
    '\u{6d6}'..='\u{6dc}',
    '\u{6df}'..='\u{6e8}',
    '\u{6ea}'..='\u{6ed}',
];

/// CJK ranges: Hiragana and Katakana, CJK Extension A and Unified Ideographs, CJK
/// Compatibility Ideographs, Hangul.
pub const CJK_RANGES: [RangeInclusive<char>; 5] = [
    '\u{3040}'..='\u{30ff}',
    '\u{3400}'..='\u{4dbf}',
    '\u{4e00}'..='\u{9fff}',
    '\u{f900}'..='\u{faff}',
    '\u{ac00}'..='\u{d7af}',
];

/// NFD, strip combining marks (and Arabic harakat if requested), then NFC.
#[must_use]
pub fn fold_diacritics(value: &str, include_arabic: bool) -> String {
    let stripped: String = value
        .nfd()
        .filter(|ch| {
            !COMBINING_MARKS.contains(ch)
                && !(include_arabic && ARABIC_MARKS.iter().any(|range| range.contains(ch)))
        })
        .collect();
    let result: String = stripped.nfc().collect();
    debug_assert!(!result.chars().any(|ch| COMBINING_MARKS.contains(&ch)));
    debug_assert!(
        !include_arabic
            || !result
                .chars()
                .any(|ch| ARABIC_MARKS.iter().any(|range| range.contains(&ch)))
    );
    result
}

/// Normalization applied to a single term on both index and query sides.
#[must_use]
pub fn process_term(term: &str, options: &TokenizerOptions) -> String {
    let normalized = if options.fold_diacritics {
        fold_diacritics(term, options.fold_arabic_diacritics)
    } else {
        term.to_owned()
    };
    let lower = normalized.to_lowercase();
    debug_assert!(
        !options.fold_diacritics || !lower.chars().any(|ch| COMBINING_MARKS.contains(&ch))
    );
    lower
}

/// True for a character in one of `CJK_RANGES`.
#[must_use]
pub fn is_cjk(ch: char) -> bool {
    CJK_RANGES.iter().any(|range| range.contains(&ch))
}
