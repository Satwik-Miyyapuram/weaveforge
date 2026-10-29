//! Term normalization shared by indexing and querying: diacritic folding,
//! lowercasing and CJK detection. Port of `packages/core/src/search/search-tokenizer.ts`.

use std::collections::HashSet;
use std::ops::RangeInclusive;

use unicode_normalization::UnicodeNormalization;

use crate::search::js_text::{is_letter_or_number, utf16_len};
use crate::search::url_parts::url_parts;

/// Options for term normalization. Callers always pass them explicitly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
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

/// Shortest camelCase or URL part kept, in UTF-16 code units (TS `part.length > 1`).
pub const MIN_TOKEN_UTF16_LEN: usize = 2;

/// Split text into search terms (see TS doc). Deduplicated, first occurrence wins.
#[must_use]
pub fn tokenize(text: &str, options: &TokenizerOptions) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    if text.is_empty() {
        return out;
    }
    if options.tokenize_urls {
        for part in url_parts(text) {
            push_unique(&mut out, &mut seen, part);
        }
    }
    let raw_tokens = text.split(|ch: char| !(is_letter_or_number(ch) || ch == '_'));
    for raw in raw_tokens.filter(|raw| !raw.is_empty()) {
        if options.split_camel_case {
            for part in camel_case_parts(raw) {
                push_unique(&mut out, &mut seen, part);
            }
        }
        let lower = process_term(raw, options);
        push_script_runs(&lower, &mut out, &mut seen);
    }
    debug_assert_eq!(seen.len(), out.len());
    debug_assert!(out.iter().all(|token| !token.is_empty()));
    out
}

/// `tokenize` then `process_term` on each token: what MiniSearch indexes.
/// Not deduplicated after processing. A term can be empty when Arabic folding
/// removes every char (U+06E5 and U+06E6 are letters and Arabic marks); the
/// TypeScript keeps it too, and MiniSearch skips it.
#[must_use]
pub fn index_terms(text: &str, options: &TokenizerOptions) -> Vec<String> {
    let tokens = tokenize(text, options);
    let terms: Vec<String> = tokens
        .iter()
        .map(|token| process_term(token, options))
        .collect();
    debug_assert_eq!(terms.len(), tokens.len());
    debug_assert!(terms.iter().all(|term| term.len() <= text.len() * 3));
    terms
}

/// Splits a camelCase or PascalCase token into lowercase parts of at least
/// `MIN_TOKEN_UTF16_LEN` units. Empty unless the token has both ASCII cases.
fn camel_case_parts(token: &str) -> Vec<String> {
    let has_lower = token.bytes().any(|b| b.is_ascii_lowercase());
    let has_upper = token.bytes().any(|b| b.is_ascii_uppercase());
    if !(has_lower && has_upper) {
        return Vec::new();
    }
    let chars: Vec<char> = token.chars().collect();
    let mut spaced = String::with_capacity(token.len() + 4);
    for (i, &ch) in chars.iter().enumerate() {
        let prev = i.checked_sub(1).and_then(|p| chars.get(p)).copied();
        let next = chars.get(i + 1).copied();
        let boundary = ch.is_ascii_uppercase()
            && prev.is_some_and(|p| {
                p.is_ascii_lowercase()
                    || p.is_ascii_digit()
                    || (p.is_ascii_uppercase() && next.is_some_and(|n| n.is_ascii_lowercase()))
            });
        if boundary {
            spaced.push(' ');
        }
        spaced.push(ch);
    }
    debug_assert!(spaced.chars().count() >= chars.len());
    debug_assert!(!spaced.starts_with(' '));
    spaced
        .split(' ')
        .filter(|part| utf16_len(part) >= MIN_TOKEN_UTF16_LEN)
        .map(str::to_lowercase)
        .collect()
}

/// Adds `token` unless already seen; empty tokens are never added.
fn push_unique(out: &mut Vec<String>, seen: &mut HashSet<String>, token: String) {
    debug_assert!(out.len() == seen.len());
    let before = out.len();
    if !token.is_empty() && seen.insert(token.clone()) {
        out.push(token);
    }
    debug_assert!(out.len() <= before + 1);
}

/// Walks a lowercased raw token, grouping runs of CJK and non-CJK characters.
/// `lower` is empty when Arabic folding removed every char; then nothing is added.
fn push_script_runs(lower: &str, out: &mut Vec<String>, seen: &mut HashSet<String>) {
    debug_assert!(out.len() == seen.len());
    let mut buffer = String::new();
    let mut buffer_is_cjk = false;
    for ch in lower.chars() {
        let cjk = is_cjk(ch);
        if !buffer.is_empty() && cjk != buffer_is_cjk {
            push_run(&buffer, buffer_is_cjk, out, seen);
            buffer.clear();
        }
        buffer_is_cjk = cjk;
        buffer.push(ch);
    }
    if !buffer.is_empty() {
        push_run(&buffer, buffer_is_cjk, out, seen);
        buffer.clear();
    }
    debug_assert!(buffer.is_empty());
}

/// Emits one script run: CJK as unigrams and bigrams, anything else whole.
fn push_run(run: &str, cjk: bool, out: &mut Vec<String>, seen: &mut HashSet<String>) {
    debug_assert!(!run.is_empty());
    let tokens = if cjk {
        cjk_tokens(run)
    } else {
        vec![run.to_owned()]
    };
    for token in tokens {
        push_unique(out, seen, token);
    }
}

/// Unigrams of every character, then bigrams of each adjacent pair.
fn cjk_tokens(run: &str) -> Vec<String> {
    debug_assert!(!run.is_empty());
    let chars: Vec<char> = run.chars().collect();
    let mut tokens: Vec<String> = chars.iter().map(char::to_string).collect();
    tokens.extend(chars.windows(2).map(|pair| pair.iter().collect::<String>()));
    debug_assert!(tokens.len() >= chars.len());
    debug_assert!(tokens.iter().all(|token| !token.is_empty()));
    tokens
}
