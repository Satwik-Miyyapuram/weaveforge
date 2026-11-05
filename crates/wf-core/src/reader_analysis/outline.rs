//! Outline inference from pdf.js text runs, for documents with no bookmarks. A
//! faithful port of packages/core/src/features/reader/outline-from-text.ts.
//!
//! Every export is pure: plain text items in, plain objects out. The one generic
//! export, `group_recurring_lines`, takes callbacks; its wasm wrapper passes indices.

// Lengths and indices stay far below 2^53, so `usize` to `f64` is exact.
#![allow(clippy::cast_precision_loss)]

use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::LazyLock;

use regex_lite::Regex;
use serde::{Deserialize, Serialize};
use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

use super::lines::{
    FURNITURE_MARGIN, furniture_key, is_bold_font, js_trim, js_trim_end, js_trim_start,
};
use crate::ink::js_math;
use crate::papers::js_regex::compile;
use crate::search::js_text::utf16_len;

/// Fewer UTF-16 characters than this and there is no body to find sections in.
pub const MIN_ANALYSABLE_CHARS: usize = 300;

/// A pdf.js text item for outline inference (`OutlineTextItem`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct OutlineTextItem {
    /// Item text.
    pub str: String,
    /// Font size in user-space units.
    pub font_size: f64,
    /// pdf.js font name, used for bold detection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Option<String>))]
    pub font_name: Option<String>,
    /// Left edge.
    pub x: f64,
    /// Baseline y.
    pub y: f64,
    /// 1-based page number.
    pub page: f64,
    /// Set on text not laid out left to right, such as arXiv's vertical side stamp.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Option<bool>))]
    pub rotated: Option<bool>,
}

/// A bookmark-shaped outline node (`ReaderOutlineItem`). `pageNumber` is always set here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct OutlineReaderItem {
    /// Heading text.
    pub title: String,
    /// 1-based page number, or null.
    pub page_number: Option<f64>,
    /// Baseline y of the heading.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Option<f64>))]
    pub y: Option<f64>,
    /// Child sections, present only when there are some.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Option<Vec<OutlineReaderItem>>))]
    pub items: Option<Vec<OutlineReaderItem>>,
}

/// Only the page of a heading (`{ page: number }`), as `outlineIsPlausible` reads it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct OutlinePageRef {
    /// 1-based page number.
    pub page: f64,
}

/// A recurring group with members as indices into the caller's array (wasm boundary form).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct OutlineRecurringGroupIndices {
    /// Furniture key shared by the members.
    pub key: String,
    /// Distinct pages in first-seen order.
    pub pages: Vec<f64>,
    /// Indices of the member lines.
    pub members: Vec<f64>,
}

/// A set of lines that print the same text (`RecurringGroup<T>`), members as values.
#[derive(Debug, Clone, PartialEq)]
pub struct OutlineRecurringGroup<T> {
    /// Furniture key shared by the members.
    pub key: String,
    /// Distinct pages in first-seen order.
    pub pages: Vec<f64>,
    /// The member lines.
    pub members: Vec<T>,
}

static NUMBERED: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^(\d+(?:\.\d+)*)\.?\s+\S").ok());
static SECTION: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(r"(?i)^(Abstract|Introduction|Related Work|Method|Results|Discussion|Conclusion|References|Appendix)\b").ok()
});
/// A bibliography heading in the languages the analyser reads; the outline stops there.
pub(crate) static REFERENCES_HEADING: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile(r"(?i)^(?:\d+(?:\.\d+)*\.?\s+)?(?:References|Bibliography|Referencias|Références|Bibliographie|Literaturverzeichnis|Literatur)\b").ok()
});
/// A table-of-contents entry: title, a run of dots, a page number.
static DOTTED_LEADER: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"(\.\s*){5,}\d*$").ok());
/// A run of digits and roman numeral letters, as a page-number or section stamp.
static ROMAN_NUMERAL: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"(?i)^[\divxlc]+$").ok());

/// JS `re.test(s)`; a pattern that failed to compile matches nothing.
pub(crate) fn re_matches(re: &LazyLock<Option<Regex>>, s: &str) -> bool {
    re.as_ref().is_some_and(|r| r.is_match(s))
}

/// The first capture group of `NUMBERED`, as JS `NUMBERED.exec(s)?.[1]`.
fn numbered_group(s: &str) -> Option<String> {
    NUMBERED
        .as_ref()?
        .captures(s)?
        .get(1)
        .map(|m| m.as_str().to_string())
}

/// `isRotatedText`: whether a pdf.js text matrix `[a, b, c, d, e, f]` sets its run rotated or mirrored.
#[must_use]
pub fn is_rotated_text(transform: &[f64]) -> bool {
    let a = transform.first().copied().unwrap_or(0.0);
    let b = transform.get(1).copied().unwrap_or(0.0);
    a <= 0.0 || b.abs() > a.abs() * 0.1
}

/// A line being joined from items; `spread` is its baseline spread.
struct Joined {
    line: OutlineTextItem,
    spread: f64,
    min_y: f64,
    max_y: f64,
}

/// `joinLines`: an item joins the last line when its baseline is within the band and it starts at or right of the line's left edge.
fn join_lines(page: &[OutlineTextItem], tolerance: f64) -> Vec<Joined> {
    let mut lines: Vec<Joined> = Vec::new();
    for item in page {
        if js_trim(&item.str).is_empty() {
            continue;
        }
        let joins = lines.last().is_some_and(|open| {
            let band = js_math::max(
                1.0,
                tolerance * js_math::max(open.line.font_size, item.font_size),
            );
            open.line.page == item.page
                && (open.line.y - item.y).abs() <= band
                && item.x >= open.line.x
        });
        if joins {
            if let Some(open) = lines.last_mut() {
                let text = format!(
                    "{} {}",
                    js_trim_end(&open.line.str),
                    js_trim_start(&item.str)
                );
                open.line.str = text;
                open.line.font_size = js_math::max(open.line.font_size, item.font_size);
                if is_bold_font(item.font_name.as_deref()) {
                    open.line.font_name = item.font_name.clone();
                }
                open.min_y = js_math::min(open.min_y, item.y);
                open.max_y = js_math::max(open.max_y, item.y);
                open.spread = open.max_y - open.min_y;
            }
        } else {
            lines.push(Joined {
                line: OutlineTextItem {
                    str: js_trim(&item.str).to_string(),
                    ..item.clone()
                },
                spread: 0.0,
                min_y: item.y,
                max_y: item.y,
            });
        }
    }
    lines
}

/// `outlineTextLines`: consecutive runs on a baseline, per page. A loose pass joins runs within
/// three quarters of a line; a tight half-line pass replaces it when the loose pass fused lines.
#[must_use]
pub fn outline_text_lines(pages: &[Vec<OutlineTextItem>]) -> Vec<OutlineTextItem> {
    let mut lines = Vec::new();
    for page in pages {
        let loose = join_lines(page, 0.75);
        // The loose pass fused what should be two lines when a line spans more than half its font size.
        if loose
            .iter()
            .any(|joined| joined.spread > joined.line.font_size * 0.5)
        {
            lines.extend(join_lines(page, 0.5).into_iter().map(|joined| joined.line));
        } else {
            lines.extend(loose.into_iter().map(|joined| joined.line));
        }
    }
    lines
}

/// `bodyFontSize`: the most common font size, rounded to a half point, ties to the smaller size.
#[must_use]
pub fn body_font_size(pages: &[Vec<OutlineTextItem>]) -> f64 {
    let mut counts: HashMap<u64, (f64, usize)> = HashMap::new();
    for item in pages.iter().flatten() {
        if js_trim(&item.str).is_empty() || !item.font_size.is_finite() || item.font_size <= 0.0 {
            continue;
        }
        // `+ 0.0` folds -0 into +0, as the JS Map key does.
        let size = js_math::round(item.font_size * 2.0) / 2.0 + 0.0;
        counts.entry(size.to_bits()).or_insert((size, 0)).1 += 1;
    }
    let mut ranked: Vec<(f64, usize)> = counts.into_values().collect();
    ranked.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then(a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal))
    });
    ranked.first().map_or(0.0, |&(size, _)| size)
}

/// `levenshtein`: edit distance over UTF-16 code units, capped at `limit` (`limit + 1` once it is exceeded).
#[must_use]
pub fn levenshtein(a: &str, b: &str, limit: f64) -> f64 {
    if a == b {
        return 0.0;
    }
    let a: Vec<u16> = a.encode_utf16().collect();
    let b: Vec<u16> = b.encode_utf16().collect();
    if (a.len() as f64 - b.len() as f64).abs() > limit {
        return limit + 1.0;
    }
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut current = vec![i];
        let mut row_min = i;
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            let value = (previous[j] + 1)
                .min(current[j - 1] + 1)
                .min(previous[j - 1] + cost);
            current.push(value);
            row_min = row_min.min(value);
        }
        if row_min as f64 > limit {
            return limit + 1.0;
        }
        previous = current;
    }
    previous[b.len()] as f64
}

/// `groupRecurringLines`: groups by furniture key. Exact keys come from a map; the edit-distance
/// search only visits groups in the same two-unit bucket with a close enough length.
#[must_use]
pub fn group_recurring_lines<'a, T>(
    lines: &'a [T],
    text_of: impl Fn(&T) -> String,
    page_of: impl Fn(&T) -> f64,
) -> Vec<OutlineRecurringGroup<&'a T>> {
    let mut groups: Vec<OutlineRecurringGroup<&'a T>> = Vec::new();
    let mut exact: HashMap<String, usize> = HashMap::new();
    let mut buckets: HashMap<(u16, u16), Vec<usize>> = HashMap::new();
    for line in lines {
        let key = furniture_key(&text_of(line));
        let units: Vec<u16> = key.encode_utf16().collect();
        if units.len() < 4 {
            continue;
        }
        let limit = (units.len().min(80) as f64 * 0.2).floor();
        let bucket_key = (units[0], units[1]);
        let mut found = exact.get(&key).copied();
        if found.is_none() {
            found = buckets.get(&bucket_key).and_then(|bucket| {
                bucket.iter().copied().find(|&g| {
                    let other = &groups[g].key;
                    (utf16_len(other) as f64 - units.len() as f64).abs() <= limit
                        && levenshtein(other, &key, limit) <= limit
                })
            });
        }
        let index = match found {
            Some(index) => index,
            None => {
                groups.push(OutlineRecurringGroup {
                    key: key.clone(),
                    pages: Vec::new(),
                    members: Vec::new(),
                });
                let index = groups.len() - 1;
                let _: Option<usize> = exact.insert(key.clone(), index);
                buckets.entry(bucket_key).or_default().push(index);
                index
            }
        };
        let group = &mut groups[index];
        let page = page_of(line);
        if !group.pages.contains(&page) {
            group.pages.push(page);
        }
        group.members.push(line);
    }
    groups
}

/// `runningHeads`: flags lines that recur (near-verbatim) on three or more pages.
fn running_heads(lines: &[OutlineTextItem]) -> Vec<bool> {
    let indices: Vec<usize> = (0..lines.len()).collect();
    let mut heads = vec![false; lines.len()];
    for group in group_recurring_lines(
        indices.as_slice(),
        |&i| lines[i].str.clone(),
        |&i| lines[i].page,
    ) {
        if group.pages.len() >= 3 {
            for &member in &group.members {
                heads[*member] = true;
            }
        }
    }
    heads
}

/// `startsLine`: a bare number with text after it on its baseline is a section number, not a page number.
fn starts_line(page: &[OutlineTextItem], index: usize) -> bool {
    let item = &page[index];
    page.iter().enumerate().any(|(j, other)| {
        j != index
            && !js_trim(&other.str).is_empty()
            && other.x > item.x
            && (other.y - item.y).abs() <= item.font_size * 0.5
    })
}

/// `cropMargins`: drops furniture from the outer 6% of each page's text extent.
fn crop_margins(pages: &[Vec<OutlineTextItem>]) -> Vec<Vec<OutlineTextItem>> {
    let mut in_band: Vec<Vec<bool>> = pages.iter().map(|page| vec![false; page.len()]).collect();
    for (p, page) in pages.iter().enumerate() {
        if page.len() < 8 {
            continue;
        }
        let min_x = page
            .iter()
            .fold(f64::INFINITY, |acc, item| js_math::min(acc, item.x));
        let max_x = page
            .iter()
            .fold(f64::NEG_INFINITY, |acc, item| js_math::max(acc, item.x));
        let min_y = page
            .iter()
            .fold(f64::INFINITY, |acc, item| js_math::min(acc, item.y));
        let max_y = page
            .iter()
            .fold(f64::NEG_INFINITY, |acc, item| js_math::max(acc, item.y));
        let dx = (max_x - min_x) * FURNITURE_MARGIN;
        let dy = (max_y - min_y) * FURNITURE_MARGIN;
        for (i, item) in page.iter().enumerate() {
            if item.x < min_x + dx
                || item.x > max_x - dx
                || item.y < min_y + dy
                || item.y > max_y - dy
            {
                in_band[p][i] = true;
            }
        }
    }
    let mut band_pages: HashMap<String, Vec<f64>> = HashMap::new();
    for (p, page) in pages.iter().enumerate() {
        for (i, item) in page.iter().enumerate() {
            if !in_band[p][i] {
                continue;
            }
            let seen = band_pages.entry(furniture_key(&item.str)).or_default();
            if !seen.contains(&item.page) {
                seen.push(item.page);
            }
        }
    }
    pages
        .iter()
        .enumerate()
        .map(|(p, page)| {
            page.iter()
                .enumerate()
                .filter(|(i, item)| {
                    if !in_band[p][*i] {
                        return true;
                    }
                    if re_matches(&ROMAN_NUMERAL, js_trim(&item.str)) {
                        return starts_line(page, *i);
                    }
                    band_pages
                        .get(&furniture_key(&item.str))
                        .map_or(0, Vec::len)
                        < 2
                })
                .map(|(_, item)| item.clone())
                .collect::<Vec<OutlineTextItem>>()
        })
        .collect()
}

/// `HAS_WORD` (`/\p{L}{2}/u`): two letters in a row somewhere in the text.
pub(crate) fn has_word(s: &str) -> bool {
    let mut previous_letter = false;
    for ch in s.chars() {
        let letter = ch.general_category_group() == GeneralCategoryGroup::Letter;
        if letter && previous_letter {
            return true;
        }
        previous_letter = letter;
    }
    false
}

/// `Object.is`-like equality for `Set` dedupe: NaN equals NaN, otherwise `==`.
fn same_value_zero(a: f64, b: f64) -> bool {
    a == b || (a.is_nan() && b.is_nan())
}

/// Pushes a finished node into its parent on the stack, or into the roots when none is open.
fn attach(
    roots: &mut Vec<OutlineReaderItem>,
    stack: &mut [(f64, OutlineReaderItem)],
    node: OutlineReaderItem,
) {
    match stack.last_mut() {
        Some((_, parent)) => parent.items.get_or_insert_with(Vec::new).push(node),
        None => roots.push(node),
    }
}

/// `outlineFromText`: infers an outline only when a document supplies no bookmarks.
#[must_use]
#[allow(clippy::too_many_lines, reason = "mirrors the TS function for parity")]
pub fn outline_from_text(all_pages: &[Vec<OutlineTextItem>]) -> Vec<OutlineReaderItem> {
    // Rotated runs are stamps and side notes, never headings; their matrix also makes them read as large type.
    let pages: Vec<Vec<OutlineTextItem>> = all_pages
        .iter()
        .map(|page| {
            page.iter()
                .filter(|item| !item.rotated.unwrap_or(false))
                .cloned()
                .collect()
        })
        .collect();
    let chars: usize = pages
        .iter()
        .flatten()
        .map(|item| utf16_len(&item.str))
        .sum();
    if chars < MIN_ANALYSABLE_CHARS {
        return Vec::new();
    }
    let body = body_font_size(&pages);
    if body == 0.0 {
        return Vec::new();
    }
    let lines = outline_text_lines(&crop_margins(&pages));
    let heads = running_heads(&lines);
    let mut headings: Vec<&OutlineTextItem> = lines
        .iter()
        .enumerate()
        .filter(|(i, line)| {
            if heads[*i] {
                return false;
            }
            let numbered = numbered_group(&line.str).is_some();
            if utf16_len(&line.str) > 120 || (!numbered && line.str.ends_with('.')) {
                return false;
            }
            if re_matches(&DOTTED_LEADER, &line.str) {
                return false;
            }
            if !has_word(&line.str) {
                return false;
            }
            line.font_size >= 1.12 * body
                || (is_bold_font(line.font_name.as_deref())
                    && (numbered || re_matches(&SECTION, &line.str)))
        })
        .map(|(_, line)| line)
        .collect();
    if let Some(references) = headings
        .iter()
        .position(|heading| re_matches(&REFERENCES_HEADING, &heading.str))
    {
        headings.truncate(references + 1);
    }
    let refs: Vec<OutlinePageRef> = headings
        .iter()
        .map(|heading| OutlinePageRef { page: heading.page })
        .collect();
    if !outline_is_plausible(&refs, pages.len() as f64) {
        return Vec::new();
    }
    let mut sizes: Vec<f64> = Vec::new();
    for heading in &headings {
        if !sizes
            .iter()
            .any(|&size| same_value_zero(size, heading.font_size))
        {
            sizes.push(heading.font_size);
        }
    }
    sizes.sort_by(|a, b| b.partial_cmp(a).unwrap_or(Ordering::Equal));

    let mut roots: Vec<OutlineReaderItem> = Vec::new();
    let mut stack: Vec<(f64, OutlineReaderItem)> = Vec::new();
    for heading in &headings {
        let level = match numbered_group(&heading.str) {
            Some(number) => number.split('.').count() as f64,
            None => sizes
                .iter()
                .position(|&size| size == heading.font_size)
                .map_or(0.0, |i| (i + 1) as f64),
        };
        let node = OutlineReaderItem {
            title: heading.str.clone(),
            page_number: Some(heading.page),
            y: Some(heading.y),
            items: None,
        };
        while stack.last().is_some_and(|(top, _)| *top >= level) {
            if let Some((_, done)) = stack.pop() {
                attach(&mut roots, &mut stack, done);
            }
        }
        stack.push((level, node));
        if re_matches(&REFERENCES_HEADING, &heading.str) {
            break;
        }
    }
    while let Some((_, done)) = stack.pop() {
        attach(&mut roots, &mut stack, done);
    }
    roots
}

/// `outlineIsPlausible`: at least three sections, and no stretch without one longer than half the document.
#[must_use]
pub fn outline_is_plausible(headings: &[OutlinePageRef], page_count: f64) -> bool {
    if headings.len() < 3 {
        return false;
    }
    if page_count < 4.0 {
        return true;
    }
    let allowed = (page_count * 0.5).ceil();
    let mut previous = 1.0;
    for heading in headings {
        if heading.page - previous > allowed {
            return false;
        }
        previous = heading.page;
    }
    page_count - previous <= allowed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(str: &str, font_size: f64, x: f64, y: f64, page: f64) -> OutlineTextItem {
        OutlineTextItem {
            str: str.to_string(),
            font_size,
            font_name: None,
            x,
            y,
            page,
            rotated: None,
        }
    }

    #[test]
    fn is_rotated_text_flags_flipped_and_skewed_matrices() {
        assert!(!is_rotated_text(&[1.0, 0.0, 0.0, 1.0, 72.0, 700.0]));
        assert!(is_rotated_text(&[0.0, 1.0, -1.0, 0.0, 10.0, 10.0]));
        assert!(is_rotated_text(&[1.0, 0.5]));
        assert!(is_rotated_text(&[]));
    }

    #[test]
    fn levenshtein_counts_edits_and_caps_at_limit() {
        assert_eq!(levenshtein("kitten", "sitting", f64::INFINITY), 3.0);
        assert_eq!(levenshtein("abc", "abc", f64::INFINITY), 0.0);
        assert_eq!(levenshtein("abc", "abcdefghij", 2.0), 3.0);
    }

    #[test]
    fn body_font_size_picks_most_common_half_point() {
        let page = vec![
            item("a", 10.0, 0.0, 0.0, 1.0),
            item("b", 10.0, 0.0, 0.0, 1.0),
            item("c", 12.0, 0.0, 0.0, 1.0),
            item("   ", 30.0, 0.0, 0.0, 1.0),
        ];
        assert_eq!(body_font_size(&[page]), 10.0);
        assert_eq!(body_font_size(&[]), 0.0);
    }

    #[test]
    fn outline_text_lines_joins_runs_on_one_baseline() {
        let page = vec![
            item("Hello ", 10.0, 0.0, 100.0, 1.0),
            item("world", 10.0, 30.0, 100.0, 1.0),
            item("next", 10.0, 0.0, 80.0, 1.0),
        ];
        let lines = outline_text_lines(&[page]);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].str, "Hello world");
        assert_eq!(lines[1].str, "next");
    }

    #[test]
    fn outline_is_plausible_needs_three_sections_spread_out() {
        let at = |pages: &[f64]| -> Vec<OutlinePageRef> {
            pages.iter().map(|&page| OutlinePageRef { page }).collect()
        };
        assert!(!outline_is_plausible(&at(&[1.0, 2.0]), 10.0));
        assert!(outline_is_plausible(&at(&[1.0, 2.0, 3.0]), 3.0));
        assert!(!outline_is_plausible(&at(&[1.0, 2.0, 3.0]), 10.0));
    }

    #[test]
    fn outline_from_text_is_empty_below_the_character_floor() {
        let page = vec![item("1 Introduction", 12.0, 0.0, 700.0, 1.0)];
        assert!(outline_from_text(&[page]).is_empty());
    }
}
