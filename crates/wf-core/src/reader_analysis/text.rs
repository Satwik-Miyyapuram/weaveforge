//! Citation text helpers: invisible-character stripping, spacing-accent composition, a
//! normalised search text mapped back to raw PDF offsets, PDF rects for spans of it, and the
//! text fingerprint and title similarity used to match references. A faithful port of
//! packages/core/src/features/reader/analysis/citation-text.ts,
//! packages/core/src/features/reader/text-fingerprint.ts and
//! packages/core/src/features/reader/title-similarity.ts.
//!
//! Stays in TS: nothing here. Every function is pure data in, data out.

// A port of JS string and number code: offsets are UTF-16 code units held as f64, and the
// float comparisons and index casts mirror JS semantics on values bounded by slice lengths.
#![allow(
    clippy::neg_cmp_op_on_partial_ord,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    clippy::cast_lossless,
    clippy::float_cmp,
    clippy::many_single_char_names,
    clippy::similar_names
)]

use crate::ink::js_math;
use crate::search::js_text::{is_js_whitespace, is_letter_or_number, utf16_len};
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;
use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

/// Spacing accents and the combining mark each one stands for. The backtick is left out.
const SPACING_ACCENTS: [(char, char); 12] = [
    ('\u{b4}', '\u{301}'),
    ('\u{2cb}', '\u{300}'),
    ('\u{a8}', '\u{308}'),
    ('\u{2c6}', '\u{302}'),
    ('\u{2dc}', '\u{303}'),
    ('\u{2c7}', '\u{30c}'),
    ('\u{2da}', '\u{30a}'),
    ('\u{b8}', '\u{327}'),
    ('\u{2d8}', '\u{306}'),
    ('\u{2d9}', '\u{307}'),
    ('\u{2dd}', '\u{30b}'),
    ('\u{af}', '\u{304}'),
];

/// Name particles dropped from the front of a surname, as in the TS `surnameKey`.
const NAME_PARTICLES: [&str; 19] = [
    "van", "von", "de", "der", "den", "del", "da", "di", "la", "le", "du", "dos", "das", "te",
    "ter", "al", "el", "bin", "ibn",
];

/// A PDF text item with optional font metrics. Mirrors `PdfItem` in the TS copy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AnalysisPdfItem {
    /// The glyph run's text.
    pub str: String,
    /// pdf.js transform `[a, b, c, d, e, f]`. A missing entry reads as the TS default.
    pub transform: Vec<f64>,
    /// Advance width of the run.
    pub width: f64,
    /// Font height, used when the transform gives no size.
    pub height: f64,
    /// Whether a line break follows the run.
    #[serde(rename = "hasEOL", default)]
    pub has_eol: bool,
    /// Font ascent as a fraction of the size, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub font_ascent: Option<f64>,
    /// Font descent as a fraction of the size, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub font_descent: Option<f64>,
}

/// Normalised search text with the raw span of each UTF-16 unit. Mirrors `SearchText` in the TS copy.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSearchText {
    /// The normalised text.
    pub text: String,
    /// Raw UTF-16 offset where each unit of `text` starts.
    pub starts: Vec<f64>,
    /// Raw UTF-16 offset where each unit of `text` ends.
    pub ends: Vec<f64>,
}

/// The `hints` argument of `isBibliographicMatch`. Mirrors its TS shape.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AnalysisBibliographicHints {
    /// Title to match; an empty title never matches.
    pub title: Option<String>,
    /// Publication year, when known.
    pub year: Option<f64>,
}

/// The `candidate` argument of `isBibliographicMatch`. Mirrors its TS shape.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AnalysisBibliographicCandidate {
    /// Candidate title.
    pub title: String,
    /// Candidate publication year, when known.
    pub year: Option<f64>,
}

/// Removes zero-width characters and maps the no-break and thin spaces to " ".
/// Twin of `stripInvisible` in citation-text.ts.
#[must_use]
pub fn strip_invisible(text: &str) -> String {
    text.chars()
        .filter(|&c| !is_invisible(c))
        .map(|c| if is_space_like(c) { ' ' } else { c })
        .collect()
}

fn is_invisible(c: char) -> bool {
    matches!(
        c,
        '\u{200b}'..='\u{200d}' | '\u{2060}' | '\u{feff}' | '\u{ad}'
    )
}

fn is_space_like(c: char) -> bool {
    matches!(c, '\u{a0}' | '\u{202f}' | '\u{2007}'..='\u{200a}')
}

/// The combining mark for a spacing accent glyph, if it is one.
fn spacing_mark(c: char) -> Option<char> {
    SPACING_ACCENTS
        .iter()
        .find(|(accent, _)| *accent == c)
        .map(|&(_, mark)| mark)
}

/// Puts a TeX spacing accent back on the letter after it. Twin of `composeSpacingAccents`.
/// An accent before anything but a letter (optionally after one space or tab) stays.
#[must_use]
pub fn compose_spacing_accents(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if let Some(mark) = spacing_mark(c) {
            let mut j = i + 1;
            if j < chars.len() && matches!(chars[j], ' ' | '\t') {
                j += 1;
            }
            if j < chars.len() && is_letter(chars[j]) {
                let pair = format!("{}{mark}", chars[j]);
                out.push_str(&pair.nfc().collect::<String>());
                i = j + 1;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

/// True for `\p{L}`.
fn is_letter(c: char) -> bool {
    c.general_category_group() == GeneralCategoryGroup::Letter
}

/// True for `\p{M}`.
fn is_mark(c: char) -> bool {
    c.general_category_group() == GeneralCategoryGroup::Mark
}

/// JS `String.prototype.trim` over the JS whitespace set.
fn js_trim(text: &str) -> &str {
    text.trim_matches(is_js_whitespace)
}

/// `item.transform[index] ?? default`.
fn tf(item: &AnalysisPdfItem, index: usize, default: f64) -> f64 {
    item.transform.get(index).copied().unwrap_or(default)
}

/// `value || fallback` for a JS number: zero and NaN are falsy.
fn or_js(value: f64, fallback: f64) -> f64 {
    if value == 0.0 || value.is_nan() {
        fallback
    } else {
        value
    }
}

/// `Number.isFinite(value) ? value : fallback` for an optional font metric.
fn finite_or(value: Option<f64>, fallback: f64) -> f64 {
    match value {
        Some(v) if v.is_finite() => v,
        _ => fallback,
    }
}

/// Font size of a text item in user-space units. Twin of `fontSizeOf`.
#[must_use]
pub fn font_size_of(item: &AnalysisPdfItem) -> f64 {
    or_js(
        or_js(
            js_math::hypot(tf(item, 2, 0.0), tf(item, 3, 0.0)),
            item.height,
        ),
        10.0,
    )
}

/// `view.starts[index] ?? 0` (or `ends`) for a JS number index: fractions, NaN and
/// out-of-range indices read as 0.
fn unit_at(values: &[f64], index: f64) -> f64 {
    if index.fract() == 0.0 && index >= 0.0 && index < values.len() as f64 {
        values[index as usize]
    } else {
        0.0
    }
}

/// Appends `text` to the view with every UTF-16 unit mapped to the raw span `start..end`.
fn push_span(view: &mut AnalysisSearchText, text: &str, start: usize, end: usize) {
    view.text.push_str(text);
    for _ in 0..utf16_len(text) {
        view.starts.push(start as f64);
        view.ends.push(end as f64);
    }
}

/// The space inserted between two items on one line when the gap is wide enough.
fn push_word_gap(
    view: &mut AnalysisSearchText,
    item: &AnalysisPdfItem,
    previous: &AnalysisPdfItem,
    cursor: usize,
) {
    let size = js_math::max(font_size_of(item), font_size_of(previous));
    let gap = tf(item, 4, 0.0) - (tf(previous, 4, 0.0) + previous.width);
    let same_line = (tf(item, 5, 0.0) - tf(previous, 5, 0.0)).abs() < size * 0.4;
    if same_line && gap > js_math::max(0.8, size * 0.13) {
        push_span(view, " ", cursor, cursor);
    }
}

/// Appends one code point of an item. `accent` holds a spacing accent waiting for its letter.
fn push_glyph(
    view: &mut AnalysisSearchText,
    glyph: char,
    cursor: &mut usize,
    accent: &mut Option<(char, usize)>,
) {
    let width = glyph.len_utf16();
    if let Some(mark) = spacing_mark(glyph) {
        *accent = Some((mark, *cursor));
        *cursor += width;
        return;
    }
    if let Some((mark, start)) = *accent {
        if is_letter(glyph) {
            let pair = format!("{glyph}{mark}");
            let composed = pair.nfc().collect::<String>().nfkc().collect::<String>();
            push_span(view, &strip_invisible(&composed), start, *cursor + width);
            *accent = None;
            *cursor += width;
            return;
        }
        if is_js_whitespace(glyph) {
            // "´ e": the space between the accent and its letter is not a word gap.
            *cursor += width;
            return;
        }
    }
    *accent = None;
    let normalized: String = strip_invisible(&glyph.to_string().nfkc().collect::<String>())
        .chars()
        .map(|c| if is_js_whitespace(c) { ' ' } else { c })
        .collect();
    push_span(view, &normalized, *cursor, *cursor + width);
    *cursor += width;
}

/// Normalised search text where every unit maps back to its raw span. Twin of `searchTextFromItems`.
#[must_use]
pub fn search_text_from_items(items: &[AnalysisPdfItem]) -> AnalysisSearchText {
    let mut view = AnalysisSearchText::default();
    let mut cursor = 0_usize;
    let mut previous: Option<&AnalysisPdfItem> = None;
    let mut accent: Option<(char, usize)> = None;
    for item in items {
        let trimmed = js_trim(&item.str);
        // An accent-only item sits over the next letter, so it is no guide to the gap.
        let accent_only = !trimmed.is_empty() && trimmed.chars().all(|g| spacing_mark(g).is_some());
        if let Some(prev) = previous {
            let joins = !accent_only
                && accent.is_none()
                && !item.str.is_empty()
                && view
                    .text
                    .chars()
                    .last()
                    .is_some_and(|c| !is_js_whitespace(c))
                && item
                    .str
                    .chars()
                    .next()
                    .is_some_and(|c| !is_js_whitespace(c));
            if joins {
                push_word_gap(&mut view, item, prev, cursor);
            }
        }
        for glyph in item.str.chars() {
            push_glyph(&mut view, glyph, &mut cursor, &mut accent);
        }
        if item.has_eol {
            accent = None;
            push_span(&mut view, " ", cursor, cursor + 1);
            cursor += 1;
        }
        if !trimmed.is_empty() && !accent_only {
            previous = Some(item);
        }
    }
    view
}

/// The raw `[start, end]` span of `view.text[start..end]`. Twin of `originalRange`.
#[must_use]
pub fn original_range(view: &AnalysisSearchText, start: f64, end: f64) -> [f64; 2] {
    [unit_at(&view.starts, start), unit_at(&view.ends, end - 1.0)]
}

/// The PDF rect `[x0, y0, x1, y1]` of `item.str[from..to]`, or `None`. Twin of `itemToRect`
/// (exported to JS as `citationItemToRect`).
#[must_use]
pub fn item_to_rect(item: &AnalysisPdfItem, from: f64, to: f64) -> Option<Vec<f64>> {
    let len = utf16_len(&item.str) as f64;
    if item.str.is_empty() || item.width <= 0.0 || to <= from {
        return None;
    }
    let a = tf(item, 0, 0.0);
    let b = tf(item, 1, 0.0);
    let c = tf(item, 2, 0.0);
    let d = tf(item, 3, 10.0);
    let x = tf(item, 4, 0.0);
    let y = tf(item, 5, 0.0);
    let size = or_js(js_math::hypot(a, b), font_size_of(item));
    let start = item.width * js_math::max(0.0, from) / len;
    let end = item.width * js_math::min(len, to) / len;
    let ascent = finite_or(item.font_ascent, 0.85);
    let descent = finite_or(item.font_descent, -0.15);
    let mut corners = Vec::with_capacity(4);
    for offset in [start, end] {
        for height in [ascent, descent] {
            corners.push([
                x + a / size * offset + c * height,
                y + b / size * offset + d * height,
            ]);
        }
    }
    let min_of = |k: usize| {
        corners
            .iter()
            .fold(f64::INFINITY, |acc, p| js_math::min(acc, p[k]))
    };
    let max_of = |k: usize| {
        corners
            .iter()
            .fold(f64::NEG_INFINITY, |acc, p| js_math::max(acc, p[k]))
    };
    let rect = [min_of(0), min_of(1), max_of(0), max_of(1)];
    if rect.iter().all(|v| v.is_finite()) {
        Some(rect.to_vec())
    } else {
        None
    }
}

/// The PDF rects covering the normalised span `start..end`. Twin of `mentionRects`.
#[must_use]
pub fn mention_rects(items: &[AnalysisPdfItem], start: f64, end: f64) -> Vec<Vec<f64>> {
    if !start.is_finite() || !end.is_finite() || end <= start {
        return Vec::new();
    }
    let mut rects = Vec::new();
    let mut cursor = 0.0_f64;
    for item in items {
        let from = cursor;
        let len = utf16_len(&item.str) as f64;
        let to = from + len;
        cursor = to + if item.has_eol { 1.0 } else { 0.0 };
        if to <= start || from >= end || js_trim(&item.str).is_empty() {
            continue;
        }
        let from_in_item = js_math::max(0.0, start - from);
        let to_in_item = js_math::min(len, end - from);
        if let Some(rect) = item_to_rect(item, from_in_item, to_in_item)
            .filter(|rect| rect[2] > rect[0] && rect[3] > rect[1])
        {
            rects.push(rect);
        }
    }
    rects
}

/// True if `text` starts with `particle` (ASCII, case-insensitive) followed by whitespace.
fn particle_at(text: &str, particle: &str) -> bool {
    text.get(..particle.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(particle))
        && text[particle.len()..]
            .chars()
            .next()
            .is_some_and(is_js_whitespace)
}

/// Drops leading name particles (`van `, `de `, ...) as the TS `^(?:(?:...)\s+)+` does.
fn strip_name_particles(mut text: &str) -> &str {
    loop {
        let found = NAME_PARTICLES
            .iter()
            .copied()
            .find(|particle| particle_at(text, particle));
        let Some(particle) = found else {
            return text;
        };
        text = text[particle.len()..].trim_start_matches(is_js_whitespace);
    }
}

/// A stable key for a surname: accents and particles removed, lowercased, letters only.
/// Twin of `surnameKey`.
#[must_use]
pub fn surname_key(name: &str) -> String {
    let decomposed: String = name.nfkd().filter(|&c| !is_mark(c)).collect();
    strip_name_particles(&decomposed)
        .to_lowercase()
        .chars()
        .filter(|&c| is_letter(c))
        .collect()
}

/// True if two rects `[x0, y0, x1, y1]` overlap with positive area. Twin of `rectanglesOverlap`.
/// A missing entry reads as NaN, as `undefined` does in the TS copy.
#[must_use]
pub fn rectangles_overlap(a: &[f64], b: &[f64]) -> bool {
    let at = |rect: &[f64], i: usize| rect.get(i).copied().unwrap_or(f64::NAN);
    js_math::min(at(a, 2), at(b, 2)) > js_math::max(at(a, 0), at(b, 0))
        && js_math::min(at(a, 3), at(b, 3)) > js_math::max(at(a, 1), at(b, 1))
}

/// Sixteen hex characters from two FNV-1a passes over the UTF-16 units of the texts.
/// Twin of `textFingerprint`.
#[must_use]
pub fn text_fingerprint(texts: &[String]) -> String {
    let mut a: u32 = 0x811c_9dc5;
    let mut b: u32 = 0x050c_5d1f;
    for text in texts {
        for (i, unit) in text.encode_utf16().enumerate() {
            let c = u32::from(unit);
            a = (a ^ c).wrapping_mul(0x0100_0193);
            let mixed = c.wrapping_mul(31).wrapping_add(i as u32) & 0xffff;
            b = (b ^ mixed).wrapping_mul(0x0100_0193);
        }
        a = (a ^ 0x0a).wrapping_mul(0x0100_0193);
        b = (b ^ 0x0a).wrapping_mul(0x0100_0193);
    }
    format!("{a:08x}{b:08x}")
}

/// The lowercased letter and number runs of a title, accents removed. Twin of the `tokens`
/// helper in `titleSimilarity`.
fn title_tokens(text: &str) -> std::collections::HashSet<String> {
    let folded: String = text
        .nfkd()
        .filter(|&c| !is_mark(c))
        .collect::<String>()
        .to_lowercase();
    folded
        .split(|c: char| !is_letter_or_number(c))
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Token-set Dice similarity in `0..=1`, insensitive to punctuation, accents and word order.
/// Twin of `titleSimilarity`.
#[must_use]
pub fn title_similarity(left: &str, right: &str) -> f64 {
    let a = title_tokens(left);
    let b = title_tokens(right);
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let common = a.iter().filter(|token| b.contains(*token)).count();
    2.0 * common as f64 / (a.len() + b.len()) as f64
}

/// True when the titles are at least 0.85 similar and the years differ by at most one (or
/// either is unknown). Twin of `isBibliographicMatch`.
#[must_use]
pub fn is_bibliographic_match(
    hints: &AnalysisBibliographicHints,
    candidate: &AnalysisBibliographicCandidate,
) -> bool {
    let Some(hint_title) = hints.title.as_deref().filter(|title| !title.is_empty()) else {
        return false;
    };
    title_similarity(hint_title, &candidate.title) >= 0.85
        && match (hints.year, candidate.year) {
            (Some(hint_year), Some(year)) => (hint_year - year).abs() <= 1.0,
            _ => true,
        }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(text: &str, x: f64, width: f64, has_eol: bool) -> AnalysisPdfItem {
        AnalysisPdfItem {
            str: text.to_owned(),
            transform: vec![10.0, 0.0, 0.0, 10.0, x, 700.0],
            width,
            height: 10.0,
            has_eol,
            font_ascent: None,
            font_descent: None,
        }
    }

    fn title(text: &str) -> AnalysisBibliographicCandidate {
        AnalysisBibliographicCandidate {
            title: text.to_owned(),
            year: None,
        }
    }

    #[test]
    fn compose_spacing_accents_puts_a_tex_spacing_accent_back_on_its_letter() {
        assert_eq!(compose_spacing_accents("Ball\u{b4}e"), "Ball\u{e9}");
        assert_eq!(compose_spacing_accents("Ball\u{b4} e"), "Ball\u{e9}");
        assert_eq!(
            compose_spacing_accents("F\u{a8}oldi\u{b4}ak"),
            "F\u{f6}ldi\u{e1}k"
        );
        // An accent before anything but a letter is left alone.
        assert_eq!(compose_spacing_accents("a \u{b4} 1"), "a \u{b4} 1");
    }

    #[test]
    fn search_text_from_items_composes_an_accent_drawn_as_its_own_item() {
        let items = [
            item("Ball", 0.0, 20.0, false),
            item("\u{b4}", 18.0, 3.0, false),
            item("e et al., 2017", 20.0, 60.0, false),
        ];
        let view = search_text_from_items(&items);
        assert_eq!(view.text, "Ball\u{e9} et al., 2017");
        // "é" (UTF-16 index 4) maps back over both the accent glyph and the letter.
        assert_eq!(original_range(&view, 4.0, 5.0), [4.0, 6.0]);
        // "2017" (UTF-16 index 14) still lines up with the raw text.
        assert_eq!(original_range(&view, 14.0, 18.0), [15.0, 19.0]);
    }

    #[test]
    fn search_text_from_items_skips_the_space_between_an_accent_and_its_letter() {
        let view = search_text_from_items(&[item("F\u{a8} oldi\u{b4} ak", 0.0, 50.0, false)]);
        assert_eq!(view.text, "F\u{f6}ldi\u{e1}k");
    }

    #[test]
    fn search_text_from_items_drops_an_accent_with_no_letter_after_it() {
        let view =
            search_text_from_items(&[item("x\u{b4}", 0.0, 10.0, true), item("1", 0.0, 5.0, false)]);
        assert_eq!(view.text, "x 1");
    }

    #[test]
    fn text_fingerprint_is_stable_order_sensitive_and_sixteen_hex_characters() {
        let a = text_fingerprint(&["page one".to_owned(), "page two".to_owned()]);
        assert_eq!(a.len(), 16);
        assert!(
            a.chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        );
        assert_eq!(
            a,
            text_fingerprint(&["page one".to_owned(), "page two".to_owned()])
        );
        assert_ne!(
            a,
            text_fingerprint(&["page two".to_owned(), "page one".to_owned()])
        );
    }

    #[test]
    fn title_scorer_enforces_title_and_year_thresholds() {
        assert_eq!(
            title_similarity("M\u{fc}ller: A method", "a method muller"),
            1.0
        );
        assert_eq!(title_similarity("", ""), 0.0);
        let hints = |year: Option<f64>| AnalysisBibliographicHints {
            title: Some("A useful method".to_owned()),
            year,
        };
        let candidate = |year: Option<f64>| AnalysisBibliographicCandidate {
            title: "A useful method".to_owned(),
            year,
        };
        assert!(is_bibliographic_match(
            &hints(Some(2020.0)),
            &candidate(Some(2021.0))
        ));
        assert!(!is_bibliographic_match(
            &hints(Some(2020.0)),
            &candidate(Some(2022.0))
        ));
        let no_hint_year = AnalysisBibliographicHints {
            title: Some("A useful method".to_owned()),
            year: None,
        };
        assert!(!is_bibliographic_match(
            &no_hint_year,
            &title("A completely different method")
        ));
    }
}
