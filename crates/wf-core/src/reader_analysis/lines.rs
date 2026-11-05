//! Text lines from pdf.js runs, column detection and running-head keys for the
//! reader's analysis. A faithful port of
//! packages/core/src/features/reader/analysis/line-reconstruction.ts and column-detection.ts.
//!
//! Stays in TS: the `keep` callback of `reconstructLines`. The wrapper calls it
//! per run and passes the verdicts in as flags.

// A port of JS number code: `!(x > 0.0)` keeps the TS NaN handling, and index
// casts mirror JS numbers used as indices, all bounded by slice lengths.
#![allow(
    clippy::neg_cmp_op_on_partial_ord,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    clippy::cast_lossless
)]

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

use crate::ink::js_math;
use crate::search::js_text::utf16_len;

/// Fraction of each page's text extent, on every side, treated as margin.
/// Mirrors `FURNITURE_MARGIN`; no wasm export, since no app file imports it.
pub const FURNITURE_MARGIN: f64 = 0.06;

/// How close two left margins must be to count as one column, in points.
const MARGIN_TOLERANCE: f64 = 10.0;
/// A line of a previous column must end this far before the next one starts.
const GUTTER: f64 = 12.0;

/// A pdf.js text item as the reader reads it (`PageTextItem`). `transform` is
/// `[a,b,c,d,e,f]`; `height` is not read, so it does not cross.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnalysisPageTextItem {
    /// Item text.
    pub str: String,
    /// PDF text matrix `[a, b, c, d, e, f]`.
    pub transform: Vec<f64>,
    /// Advance width in user space.
    pub width: f64,
    /// pdf.js `hasEOL`: a line break follows the item.
    #[serde(rename = "hasEOL", default)]
    pub has_eol: Option<bool>,
    /// pdf.js font name, used for bold detection.
    #[serde(default)]
    pub font_name: Option<String>,
}

/// The `{ str, hasEOL? }` shape `pageTextFromItems` takes.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnalysisTextRun {
    /// Run text.
    pub str: String,
    /// pdf.js `hasEOL`: a line break follows the run.
    #[serde(rename = "hasEOL", default)]
    pub has_eol: Option<bool>,
}

/// One reconstructed line (`TextLine`). Field order is the TS object's key order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnalysisTextLine {
    /// 1-based page number.
    pub page: f64,
    /// Line text.
    pub text: String,
    /// Left edge.
    pub x: f64,
    /// Baseline y.
    pub y: f64,
    /// Right edge.
    pub right: f64,
    /// Largest font size on the line.
    pub font_size: f64,
    /// True when the line's font is bold.
    pub bold: bool,
    /// Start offset in the page text.
    pub start: f64,
    /// End offset in the page text.
    pub end: f64,
}

/// A line with its column (`{ line, column }`) for `sortByReadingOrder`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct AnalysisTaggedLine {
    /// The line.
    pub line: AnalysisTextLine,
    /// Column index from `detectColumns`.
    pub column: f64,
}

/// JS `\s` and `trim()` set.
pub(crate) fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

pub(crate) fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

pub(crate) fn js_trim_start(s: &str) -> &str {
    s.trim_start_matches(is_js_space)
}

pub(crate) fn js_trim_end(s: &str) -> &str {
    s.trim_end_matches(is_js_space)
}

/// `pageTextFromItems`: runs concatenated, `\n` after each `hasEOL` run.
#[must_use]
pub fn page_text_from_items(items: &[AnalysisTextRun]) -> String {
    let mut text = String::new();
    for item in items {
        text.push_str(&item.str);
        if item.has_eol.unwrap_or(false) {
            text.push('\n');
        }
    }
    text
}

/// `isBoldFont`: a bold, Black or Heavy face, any case. ASCII folding matches
/// the JS `/i` flag here, since no non-ASCII character folds onto these letters.
#[must_use]
pub fn is_bold_font(font_name: Option<&str>) -> bool {
    let lower = font_name.unwrap_or("").to_ascii_lowercase();
    ["bold", "black", "heavy"]
        .iter()
        .any(|word| lower.contains(word))
}

/// `furnitureKey`: lower case, JS-whitespace runs to one space, digit runs to `#`.
#[must_use]
pub fn furniture_key(s: &str) -> String {
    let mut spaced = String::with_capacity(s.len());
    let mut prev_space = false;
    for c in s.to_lowercase().chars() {
        if is_js_space(c) {
            if !prev_space {
                spaced.push(' ');
            }
            prev_space = true;
        } else {
            prev_space = false;
            spaced.push(c);
        }
    }
    let mut out = String::with_capacity(spaced.len());
    let mut prev_digit = false;
    for c in spaced.chars() {
        if c.is_ascii_digit() {
            if !prev_digit {
                out.push('#');
            }
            prev_digit = true;
        } else {
            prev_digit = false;
            out.push(c);
        }
    }
    out
}

/// A page's run with geometry and offsets lifted out of the transform (`Run`).
struct Run<'a> {
    text: &'a str,
    bold: bool,
    start: f64,
    end: f64,
    font_size: f64,
    x: f64,
    y: f64,
    right: f64,
}

/// `runsOf`: offsets count every item, kept or not. `keep` of `None` keeps all;
/// otherwise a missing flag drops the run.
fn runs_of<'a>(items: &'a [AnalysisPageTextItem], keep: Option<&[bool]>) -> Vec<Run<'a>> {
    let mut runs = Vec::new();
    let mut len = 0.0_f64;
    for (i, item) in items.iter().enumerate() {
        let start = len;
        let str_len = utf16_len(&item.str) as f64;
        len += str_len
            + if item.has_eol.unwrap_or(false) {
                1.0
            } else {
                0.0
            };
        let kept = match keep {
            None => true,
            Some(flags) => flags.get(i).copied().unwrap_or(false),
        };
        if js_trim(&item.str).is_empty() || !kept {
            continue;
        }
        let t = |k: usize| item.transform.get(k).copied().unwrap_or(0.0);
        let width = if item.width.is_nan() || item.width == 0.0 {
            0.0
        } else {
            item.width
        };
        runs.push(Run {
            text: &item.str,
            bold: is_bold_font(item.font_name.as_deref()),
            start,
            end: start + str_len,
            font_size: js_math::hypot(t(2), t(3)),
            x: t(4),
            y: t(5),
            right: t(4) + width,
        });
    }
    runs
}

/// A line being joined from runs (`Joined`); `spread` is its baseline spread.
struct Joined {
    text: String,
    x: f64,
    y: f64,
    right: f64,
    font_size: f64,
    bold: bool,
    start: f64,
    end: f64,
    spread: f64,
    min_y: f64,
    max_y: f64,
}

/// `joinRuns`: a run joins the last line when its baseline is within the band
/// and it starts at or right of the line's left edge.
fn join_runs(runs: &[Run<'_>], tolerance: f64) -> Vec<Joined> {
    let mut lines: Vec<Joined> = Vec::new();
    for run in runs {
        let joins = lines.last().is_some_and(|line| {
            let band = js_math::max(1.0, tolerance * js_math::max(line.font_size, run.font_size));
            (line.y - run.y).abs() <= band && run.x >= line.x
        });
        let open = if joins { lines.last_mut() } else { None };
        match open {
            Some(line) => {
                line.text = format!("{} {}", js_trim_end(&line.text), js_trim_start(run.text));
                line.font_size = js_math::max(line.font_size, run.font_size);
                if run.bold {
                    line.bold = true;
                }
                line.right = js_math::max(line.right, run.right);
                line.end = run.end;
                line.min_y = js_math::min(line.min_y, run.y);
                line.max_y = js_math::max(line.max_y, run.y);
                line.spread = line.max_y - line.min_y;
            }
            None => lines.push(Joined {
                text: js_trim(run.text).to_string(),
                x: run.x,
                y: run.y,
                right: run.right,
                font_size: run.font_size,
                bold: run.bold,
                start: run.start,
                end: run.end,
                spread: 0.0,
                min_y: run.y,
                max_y: run.y,
            }),
        }
    }
    lines
}

/// `reconstructLines`: a loose band first, tightened when the loose pass fuses
/// lines. `keep` of `None` keeps every run (the TS default).
#[must_use]
pub fn reconstruct_lines(
    page: f64,
    items: &[AnalysisPageTextItem],
    keep: Option<&[bool]>,
) -> Vec<AnalysisTextLine> {
    let runs = runs_of(items, keep);
    let loose = join_runs(&runs, 0.75);
    let joined = if loose.iter().any(|line| line.spread > line.font_size * 0.5) {
        join_runs(&runs, 0.5)
    } else {
        loose
    };
    joined
        .into_iter()
        .map(|line| AnalysisTextLine {
            page,
            text: line.text,
            x: line.x,
            y: line.y,
            right: line.right,
            font_size: line.font_size,
            bold: line.bold,
            start: line.start,
            end: line.end,
        })
        .collect()
}

/// A left-margin cluster (`clusters` entry): running mean `x`, member line indexes.
struct Cluster {
    x: f64,
    count: f64,
    members: Vec<usize>,
}

/// `detectColumns`: column index (0-based) for each line, all on one page.
#[must_use]
pub fn detect_columns(lines: &[AnalysisTextLine]) -> Vec<f64> {
    let zeros = || vec![0.0; lines.len()];
    if lines.len() < 4 {
        return zeros();
    }
    let page_right = lines
        .iter()
        .fold(f64::NEG_INFINITY, |acc, line| js_math::max(acc, line.right));
    let page_left = lines
        .iter()
        .fold(f64::INFINITY, |acc, line| js_math::min(acc, line.x));
    let width = page_right - page_left;
    if width <= 0.0 {
        return zeros();
    }

    // Cluster left margins.
    let mut clusters: Vec<Cluster> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if let Some(cluster) = clusters
            .iter_mut()
            .find(|c| (c.x - line.x).abs() <= MARGIN_TOLERANCE)
        {
            cluster.x = (cluster.x * cluster.count + line.x) / (cluster.count + 1.0);
            cluster.count += 1.0;
            cluster.members.push(i);
        } else {
            clusters.push(Cluster {
                x: line.x,
                count: 1.0,
                members: vec![i],
            });
        }
    }
    let min_count = js_math::max(3.0, lines.len() as f64 / 10.0);
    let mut dominant: Vec<&Cluster> = clusters.iter().filter(|c| c.count >= min_count).collect();
    dominant.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(Ordering::Equal));

    // A two-column page: the second dominant margin sits past the page's middle
    // and the first column's lines stop short of it.
    let Some((first, others)) = dominant.split_first() else {
        return zeros();
    };
    let second = others.iter().find(|c| {
        c.x >= page_left + width * 0.42
            && first
                .members
                .iter()
                .all(|&m| lines[m].right <= c.x + GUTTER || lines[m].right >= page_right - 2.0)
    });
    let Some(second) = second else {
        return zeros();
    };

    lines
        .iter()
        .map(|line| {
            if line.x >= second.x - MARGIN_TOLERANCE {
                1.0
            } else {
                0.0
            }
        })
        .collect()
}

/// The reading-order comparator's difference (`sortByReadingOrder`'s `a - b || ...`).
/// JS `||` skips 0 and NaN, so the first non-zero, non-NaN key wins.
fn reading_order_diff(a: &AnalysisTaggedLine, b: &AnalysisTaggedLine) -> f64 {
    let keys = [
        a.line.page - b.line.page,
        a.column - b.column,
        b.line.y - a.line.y,
    ];
    keys.into_iter()
        .find(|d| *d != 0.0 && !d.is_nan())
        .unwrap_or(a.line.x - b.line.x)
}

/// Stable merge sort over indices. Never panics on an inconsistent comparator,
/// unlike `slice::sort_by`; for a consistent one it matches JS's stable sort.
fn merge_sort(v: &[usize], cmp: &dyn Fn(usize, usize) -> Ordering) -> Vec<usize> {
    if v.len() <= 1 {
        return v.to_vec();
    }
    let mid = v.len() / 2;
    let left = merge_sort(&v[..mid], cmp);
    let right = merge_sort(&v[mid..], cmp);
    let mut out = Vec::with_capacity(v.len());
    let (mut i, mut j) = (0, 0);
    while i < left.len() && j < right.len() {
        // Take from the right only when strictly before the left: keeps it stable.
        if cmp(right[j], left[i]) == Ordering::Less {
            out.push(right[j]);
            j += 1;
        } else {
            out.push(left[i]);
            i += 1;
        }
    }
    out.extend_from_slice(&left[i..]);
    out.extend_from_slice(&right[j..]);
    out
}

/// `sortByReadingOrder` as the new order of the input indices: page, then column,
/// then top to bottom. The caller maps indices back to its own objects.
#[must_use]
pub fn sort_by_reading_order_indices(tagged: &[AnalysisTaggedLine]) -> Vec<usize> {
    let order: Vec<usize> = (0..tagged.len()).collect();
    merge_sort(&order, &|a, b| {
        let d = reading_order_diff(&tagged[a], &tagged[b]);
        if d < 0.0 {
            Ordering::Less
        } else if d > 0.0 {
            Ordering::Greater
        } else {
            Ordering::Equal
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(str: &str, has_eol: Option<bool>) -> AnalysisTextRun {
        AnalysisTextRun {
            str: str.to_string(),
            has_eol,
        }
    }

    #[test]
    fn page_text_from_items_joins_runs_with_eol_newlines() {
        assert_eq!(page_text_from_items(&[]), "");
        assert_eq!(
            page_text_from_items(&[
                run("see ", None),
                run("[12]", Some(true)),
                run("", Some(true)),
                run("tail", None),
            ]),
            "see [12]\n\ntail"
        );
        assert_eq!(
            page_text_from_items(&[run("a", Some(false)), run("b", Some(true))]),
            "ab\n"
        );
    }

    #[test]
    fn is_bold_font_matches_bold_black_and_heavy_any_case_only() {
        for name in [
            "Times-Bold",
            "NimbusSan-BoldItalic",
            "Arial Black",
            "Roboto-Heavy",
            "CMBX10+bold",
        ] {
            assert!(is_bold_font(Some(name)), "{name}");
        }
        for name in [
            None,
            Some(""),
            Some("Times-Roman"),
            Some("CMR10"),
            Some("Helvetica-Oblique"),
        ] {
            assert!(!is_bold_font(name), "{name:?}");
        }
    }

    #[test]
    fn furniture_key_lowercases_collapses_spaces_and_masks_digits() {
        assert_eq!(furniture_key("Journal  of\tTests 12"), "journal of tests #");
        assert_eq!(furniture_key("Page 3 of 10"), "page # of #");
        assert_eq!(furniture_key("ABC"), "abc");
        assert_eq!(FURNITURE_MARGIN.to_bits(), 0.06_f64.to_bits());
    }
}
