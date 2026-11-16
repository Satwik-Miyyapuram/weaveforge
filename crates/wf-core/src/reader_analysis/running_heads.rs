//! Running-head and page-furniture removal: repeated headers and footers, page
//! numbers and banners. A faithful port of
//! packages/core/src/features/reader/analysis/running-heads.ts.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use regex_lite::Regex;

use super::lines::{AnalysisTextLine, FURNITURE_MARGIN, furniture_key, js_trim};
use super::outline::{group_recurring_lines, re_matches};
use super::reference_section::STRUCTURAL_HEADING;
use crate::ink::js_math;
use crate::papers::js_regex::compile;

/// A digit or roman-numeral run, as a page-number or section stamp.
static ROMAN_NUMERAL: LazyLock<Option<Regex>> = LazyLock::new(|| compile(r"(?i)^[\divxlc]+$").ok());

/// The lines that are page furniture rather than content, as a `Vec<bool>`
/// aligned with `lines` (`true` = furniture). Identity is the normalised text with
/// digits masked, matched within a fifth of the shorter line's length, so
/// "Smith et al. 12" and "Smith et al. 13" are the same head.
#[must_use]
pub fn furniture_lines(lines: &[AnalysisTextLine]) -> Vec<bool> {
    let mut furniture = vec![false; lines.len()];
    mark_recurring(lines, &mut furniture);
    mark_margin_band(lines, &mut furniture);
    furniture
}

/// Sets `furniture[index]`, ignoring an index past the end.
fn mark(furniture: &mut [bool], index: usize) {
    if let Some(slot) = furniture.get_mut(index) {
        *slot = true;
    }
}

/// Marks lines that recur (near-)verbatim on three or more pages, except headings.
fn mark_recurring(lines: &[AnalysisTextLine], furniture: &mut [bool]) {
    let indexed: Vec<(usize, &AnalysisTextLine)> = lines.iter().enumerate().collect();
    let groups = group_recurring_lines(&indexed, |item| item.1.text.clone(), |item| item.1.page);
    for group in groups {
        if group.pages.len() < 3 {
            continue;
        }
        for member in group.members {
            // A heading is content however many pages it recurs on.
            if re_matches(&STRUCTURAL_HEADING, &member.1.text) {
                continue;
            }
            mark(furniture, member.0);
        }
    }
}

/// Indices of a page's lines inside its outer `FURNITURE_MARGIN` band. A page
/// with fewer than eight lines has no band.
fn band_members(lines: &[AnalysisTextLine], members: &[usize]) -> Vec<usize> {
    if members.len() < 8 {
        return Vec::new();
    }
    let page: Vec<&AnalysisTextLine> = members.iter().filter_map(|&i| lines.get(i)).collect();
    let min_x = page.iter().map(|l| l.x).fold(f64::INFINITY, js_math::min);
    let max_x = page
        .iter()
        .map(|l| l.right)
        .fold(f64::NEG_INFINITY, js_math::max);
    let min_y = page.iter().map(|l| l.y).fold(f64::INFINITY, js_math::min);
    let max_y = page
        .iter()
        .map(|l| l.y)
        .fold(f64::NEG_INFINITY, js_math::max);
    let dx = (max_x - min_x) * FURNITURE_MARGIN;
    let dy = (max_y - min_y) * FURNITURE_MARGIN;
    members
        .iter()
        .copied()
        .filter(|&i| {
            lines.get(i).is_some_and(|l| {
                l.x < min_x + dx || l.right > max_x - dx || l.y < min_y + dy || l.y > max_y - dy
            })
        })
        .collect()
}

/// Margin-band rule: bare page numbers and band lines that recur on another page
/// are furniture. Headings are never dropped; the topmost title stays in the band.
fn mark_margin_band(lines: &[AnalysisTextLine], furniture: &mut [bool]) {
    let mut by_page: HashMap<u64, Vec<usize>> = HashMap::new();
    for (i, line) in lines.iter().enumerate() {
        by_page.entry(line.page.to_bits()).or_default().push(i);
    }
    let mut in_band: Vec<usize> = Vec::new();
    for members in by_page.values() {
        in_band.extend(band_members(lines, members));
    }

    let mut band_pages: HashMap<String, HashSet<u64>> = HashMap::new();
    for &i in &in_band {
        let Some(line) = lines.get(i) else {
            continue;
        };
        let _ = band_pages
            .entry(furniture_key(&line.text))
            .or_default()
            .insert(line.page.to_bits());
    }

    for &i in &in_band {
        let Some(line) = lines.get(i) else {
            continue;
        };
        if re_matches(&ROMAN_NUMERAL, js_trim(&line.text)) {
            mark(furniture, i);
            continue;
        }
        if re_matches(&STRUCTURAL_HEADING, &line.text) {
            continue;
        }
        let pages = band_pages
            .get(&furniture_key(&line.text))
            .map_or(0, HashSet::len);
        if pages >= 2 {
            mark(furniture, i);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A line at the default 10-point body size, not bold.
    fn line(text: &str, page: f64, x: f64, y: f64) -> AnalysisTextLine {
        AnalysisTextLine {
            page,
            text: text.to_string(),
            x,
            y,
            right: x + text.chars().count() as f64 * 5.0,
            font_size: 10.0,
            bold: false,
            start: 0.0,
            end: 0.0,
        }
    }

    #[test]
    fn recurring_running_head_is_furniture_and_content_is_not() {
        let mut lines = Vec::new();
        for page in [1.0, 2.0, 3.0] {
            lines.push(line("Journal of Things Vol 4", page, 100.0, 750.0));
        }
        lines.push(line("A unique sentence of body text.", 1.0, 100.0, 500.0));
        let furniture = furniture_lines(&lines);
        assert_eq!(furniture, vec![true, true, true, false]);
    }

    #[test]
    fn heads_differing_only_in_digits_are_the_same_furniture() {
        let mut lines = Vec::new();
        for page in [1.0, 2.0, 3.0] {
            lines.push(line(
                &format!("Smith et al. {}", 12.0 + page),
                page,
                100.0,
                750.0,
            ));
        }
        let furniture = furniture_lines(&lines);
        assert_eq!(furniture, vec![true, true, true]);
    }

    #[test]
    fn structural_heading_recurring_on_three_pages_is_not_furniture() {
        let mut lines = Vec::new();
        for page in [1.0, 2.0, 3.0] {
            lines.push(line("Introduction", page, 100.0, 750.0));
        }
        let furniture = furniture_lines(&lines);
        assert_eq!(furniture, vec![false, false, false]);
    }
}
