//! Result snippets around the densest cluster of matches. Port of
//! `buildExcerpt` in `packages/core/src/search/search-excerpt.ts`. Text and
//! offsets are UTF-16 code units, like the TypeScript.

use crate::search::js_text::{is_js_whitespace, utf16_len};

/// Smallest snippet length; smaller `max_chars` values are raised to it.
pub const EXCERPT_MIN_CHARS: usize = 40;
/// Snippet length when `max_chars` is `None`.
pub const EXCERPT_DEFAULT_CHARS: usize = 240;

/// UTF-16 code unit for `…`.
const ELLIPSIS: u16 = 0x2026;

/// A highlight, as UTF-16 offsets into `Excerpt::text`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct ExcerptRange {
    /// First unit.
    pub start: usize,
    /// One past the last unit.
    pub end: usize,
}

/// A snippet with its highlights.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Excerpt {
    /// UTF-16 snippet, with a leading/trailing `…` (U+2026) where it was cut.
    pub text: Vec<u16>,
    /// Sorted, non-overlapping highlight ranges into `text`.
    pub highlights: Vec<ExcerptRange>,
}

/// Snippet options.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExcerptOptions {
    /// Target length in UTF-16 units; `None` means `EXCERPT_DEFAULT_CHARS`.
    pub max_chars: Option<usize>,
    /// Collapse whitespace runs (newlines included) to one space.
    pub single_line: bool,
}

impl Default for ExcerptOptions {
    /// `max_chars: None`, `single_line: true`.
    fn default() -> Self {
        Self {
            max_chars: None,
            single_line: true,
        }
    }
}

/// Case-folded text, with a map from each folded char back to UTF-16 offsets.
struct Fold {
    /// Lowercased text.
    hay: String,
    /// One `(start, end)` UTF-16 span per char of `hay`.
    spans: Vec<(usize, usize)>,
    /// Byte offset in `hay` where each char starts.
    starts: Vec<usize>,
}

/// Build a snippet around the densest cluster of matches for `terms`.
#[must_use]
pub fn build_excerpt(body: &str, terms: &[String], options: ExcerptOptions) -> Excerpt {
    let max = EXCERPT_MIN_CHARS.max(options.max_chars.unwrap_or(EXCERPT_DEFAULT_CHARS));
    debug_assert!(max >= EXCERPT_MIN_CHARS);
    let text = clean_text(body, options.single_line);
    if text.is_empty() {
        return Excerpt::default();
    }
    let fold = fold_index(&text);
    let ranges = merge_ranges(find_ranges(terms, &fold));
    let units: Vec<u16> = text.encode_utf16().collect();
    let excerpt = if ranges.is_empty() {
        head_excerpt(&units, max)
    } else {
        window_excerpt(&units, &ranges, max)
    };
    debug_assert!(excerpt.text.len() <= max.saturating_add(2));
    excerpt
}

/// Collapse whitespace runs (if `single_line`) and trim the ends.
fn clean_text(body: &str, single_line: bool) -> String {
    let mut out = String::with_capacity(body.len());
    if single_line {
        let mut in_space = false;
        for ch in body.chars() {
            if is_js_whitespace(ch) {
                if !in_space {
                    out.push(' ');
                }
                in_space = true;
            } else {
                out.push(ch);
                in_space = false;
            }
        }
    } else {
        out.push_str(body);
    }
    let trimmed = out.trim_matches(is_js_whitespace).to_owned();
    debug_assert!(!trimmed.chars().next().is_some_and(is_js_whitespace));
    debug_assert!(!trimmed.chars().last().is_some_and(is_js_whitespace));
    trimmed
}

/// Lowercase `text` char by char, recording where each folded char came from.
fn fold_index(text: &str) -> Fold {
    let mut fold = Fold {
        hay: String::with_capacity(text.len()),
        spans: Vec::with_capacity(text.len()),
        starts: Vec::with_capacity(text.len()),
    };
    let mut at = 0;
    for ch in text.chars() {
        let width = ch.len_utf16();
        for low in ch.to_lowercase() {
            fold.starts.push(fold.hay.len());
            fold.hay.push(low);
            fold.spans.push((at, at.saturating_add(width)));
        }
        at = at.saturating_add(width);
    }
    debug_assert_eq!(fold.spans.len(), fold.hay.chars().count());
    debug_assert_eq!(fold.starts.len(), fold.spans.len());
    fold
}

/// Hay char index containing the byte `byte`.
fn char_index(starts: &[usize], byte: usize) -> Option<usize> {
    debug_assert!(starts.first().is_none_or(|&first| first == 0));
    let index = starts
        .partition_point(|&start| start <= byte)
        .checked_sub(1);
    debug_assert!(index.is_none_or(|i| i < starts.len()));
    index
}

/// Non-overlapping, case-insensitive matches of every usable term, in UTF-16.
fn find_ranges(terms: &[String], fold: &Fold) -> Vec<ExcerptRange> {
    debug_assert_eq!(fold.starts.len(), fold.spans.len());
    let mut raw = Vec::new();
    for term in terms {
        let trimmed = term.trim_matches(is_js_whitespace);
        if utf16_len(trimmed) < 2 {
            continue;
        }
        let needle = trimmed.to_lowercase();
        if needle.is_empty() {
            continue;
        }
        let mut from = 0;
        while let Some(found) = fold
            .hay
            .get(from..)
            .and_then(|rest| rest.find(needle.as_str()))
        {
            let idx = from.saturating_add(found);
            let last_byte = idx.saturating_add(needle.len().saturating_sub(1));
            let (Some(first), Some(last)) = (
                char_index(&fold.starts, idx),
                char_index(&fold.starts, last_byte),
            ) else {
                break;
            };
            let (Some(a), Some(b)) = (fold.spans.get(first), fold.spans.get(last)) else {
                break;
            };
            raw.push(ExcerptRange {
                start: a.0,
                end: b.1,
            });
            from = idx.saturating_add(needle.len());
        }
    }
    debug_assert!(raw.iter().all(|range| range.start < range.end));
    raw
}

/// Sort and join overlapping or touching ranges so highlights never double-wrap.
fn merge_ranges(mut ranges: Vec<ExcerptRange>) -> Vec<ExcerptRange> {
    ranges.sort_by_key(|range| (range.start, range.end));
    let mut merged: Vec<ExcerptRange> = Vec::with_capacity(ranges.len());
    for range in ranges {
        match merged.last_mut() {
            Some(last) if range.start <= last.end => last.end = last.end.max(range.end),
            _ => merged.push(range),
        }
    }
    debug_assert!(merged.iter().all(|range| range.start < range.end));
    debug_assert!(
        merged
            .windows(2)
            .all(|w| matches!(w, [a, b] if a.end < b.start))
    );
    merged
}

/// Start of the window (of `max` units) holding the most ranges.
#[must_use]
fn best_window_start(ranges: &[ExcerptRange], max: usize, n: usize) -> usize {
    debug_assert!(!ranges.is_empty());
    debug_assert!(max >= EXCERPT_MIN_CHARS);
    let off = max.saturating_mul(3) / 10;
    let mut best_start = ranges.first().map_or(0, |r| r.start.saturating_sub(off));
    let mut best_count = 0;
    let (mut lo, mut hi) = (0, 0);
    for range in ranges {
        let s = range.start.saturating_sub(off);
        let e = s.saturating_add(max);
        while ranges.get(lo).is_some_and(|r| r.start < s) {
            lo += 1;
        }
        hi = hi.max(lo);
        while ranges.get(hi).is_some_and(|r| r.end <= e) {
            hi += 1;
        }
        let count = hi.saturating_sub(lo);
        if count > best_count {
            best_count = count;
            best_start = s;
        }
    }
    best_start.min(n.saturating_sub(max))
}

/// Snippet of the first `max` units, for bodies with no match.
#[must_use]
fn head_excerpt(units: &[u16], max: usize) -> Excerpt {
    debug_assert!(max >= EXCERPT_MIN_CHARS);
    let mut text: Vec<u16> = units.iter().take(max).copied().collect();
    if units.len() > max {
        text.push(ELLIPSIS);
    }
    debug_assert!(text.len() <= max.saturating_add(1));
    Excerpt {
        text,
        highlights: Vec::new(),
    }
}

/// Snippet of the best `max`-unit window over `ranges` (merged, non-empty).
#[must_use]
fn window_excerpt(units: &[u16], ranges: &[ExcerptRange], max: usize) -> Excerpt {
    let n = units.len();
    let start = best_window_start(ranges, max, n);
    let end = n.min(start.saturating_add(max));
    let prefix = usize::from(start > 0);
    let mut text = Vec::with_capacity(end.saturating_sub(start).saturating_add(2));
    if prefix == 1 {
        text.push(ELLIPSIS);
    }
    text.extend_from_slice(units.get(start..end).unwrap_or_default());
    if end < n {
        text.push(ELLIPSIS);
    }
    let highlights: Vec<ExcerptRange> = ranges
        .iter()
        .filter(|r| r.end > start && r.start < end)
        .map(|r| ExcerptRange {
            start: r.start.saturating_sub(start).saturating_add(prefix),
            end: end.min(r.end).saturating_sub(start).saturating_add(prefix),
        })
        .collect();
    debug_assert!(text.len() <= max.saturating_add(2));
    debug_assert!(
        highlights
            .iter()
            .all(|h| h.start < h.end && h.end <= text.len())
    );
    Excerpt { text, highlights }
}
