//! Which pages of a PDF the user meant: `all`, or a comma-separated list of
//! numbers and `from-to` ranges. A port of
//! `apps/web/src/features/ink/application/pdf-pages.ts`.
//!
//! Spaces are free, an empty answer names no pages, and duplicates collapse. A
//! range only walks the pages the document has; the lowest page past the end
//! is kept as `out_of_range` so the dialog can name it.

use serde::{Deserialize, Serialize};

use crate::search::js_text::is_js_whitespace;

/// Which pages an answer names.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PageSelection {
    /// Every page named that the document has, sorted and deduplicated.
    pub pages: Vec<f64>,
    /// The lowest page named past the page count, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub out_of_range: Option<f64>,
}

/// Whether the answer is `all` (any case, alone, spaces around allowed).
#[must_use]
pub fn is_all_pages(answer: &str) -> bool {
    answer
        .trim_matches(is_js_whitespace)
        .eq_ignore_ascii_case("all")
}

/// JS `Number(text)` for the non-range parts of a list: decimal with an
/// exponent, `Infinity`, and `0x`/`0o`/`0b` integers. Anything else is NaN.
fn js_number(text: &str) -> f64 {
    let text = text.trim_matches(is_js_whitespace);
    if text.is_empty() {
        return 0.0;
    }
    match text {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(digits) = text.strip_prefix(prefix) {
            return u64::from_str_radix(digits, radix).map_or(f64::NAN, |n| n as f64);
        }
    }
    if is_decimal_literal(text) {
        text.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

/// `[+-]? digits [. digits] [e [+-] digits]`, with at least one digit before or after the point.
fn is_decimal_literal(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut i = 0;
    if matches!(bytes.first(), Some(b'+' | b'-')) {
        i += 1;
    }
    let int_start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    let mut digits = i - int_start;
    if bytes.get(i) == Some(&b'.') {
        i += 1;
        let frac_start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        digits += i - frac_start;
    }
    if digits == 0 {
        return false;
    }
    if matches!(bytes.get(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(bytes.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        let exp_start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i == exp_start {
            return false;
        }
    }
    i == bytes.len()
}

/// The `(from, to)` text of a `from-to` range, with the regex's shape: digits
/// and spaces on each side of one dash. `None` for anything else.
fn split_range(range: &str) -> Option<(&str, &str)> {
    let (left, right) = range.split_once('-')?;
    if right.contains('-') {
        return None;
    }
    let left = left.trim_end_matches(is_js_whitespace);
    let right = right.trim_start_matches(is_js_whitespace);
    let digits_only = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
    (digits_only(left) && digits_only(right)).then_some((left, right))
}

/// Parse a page list against a document of `count` pages.
#[must_use]
pub fn parse_page_list(answer: &str, count: f64) -> PageSelection {
    let mut pages: Vec<f64> = Vec::new();
    let mut out_of_range: Option<f64> = None;
    let mut past = |page: f64| {
        if out_of_range.is_none_or(|lowest| page < lowest) {
            out_of_range = Some(page);
        }
    };

    for part in answer.split(',') {
        let range = part.trim_matches(is_js_whitespace);
        if range.is_empty() {
            continue;
        }
        if let Some((start, end)) = split_range(range) {
            // A bare dash names nothing.
            if start.is_empty() && end.is_empty() {
                continue;
            }
            let from = if start.is_empty() {
                1.0
            } else {
                js_number(start)
            };
            // An open end runs to the last page; past the end it names only `from`.
            let to = if end.is_empty() {
                from.max(count)
            } else {
                js_number(end)
            };
            // A reversed range is read the way it was probably meant.
            let low = from.min(to);
            let high = from.max(to);
            let mut page = low.max(1.0);
            while page <= high.min(count) {
                pages.push(page);
                page += 1.0;
            }
            if high > count {
                past(low.max(count + 1.0));
            }
            continue;
        }
        let single = js_number(range);
        if !single.is_finite() || single <= 0.0 {
            continue;
        }
        if single > count {
            past(single);
        } else {
            pages.push(single);
        }
    }

    pages.sort_by(f64::total_cmp);
    pages.dedup();
    PageSelection {
        pages,
        out_of_range,
    }
}

/// The whole answer, bounds applied: `all` gives every page, otherwise the
/// parsed list filtered to the pages the document has. Empty means do nothing.
#[must_use]
pub fn selected_pdf_pages(answer: &str, count: f64) -> Vec<f64> {
    if is_all_pages(answer) {
        let mut all = Vec::new();
        let mut page = 1.0;
        while page <= count {
            all.push(page);
            page += 1.0;
        }
        return all;
    }
    parse_page_list(answer, count).pages
}

/// What the dialog's validation line says about an answer, or `None` if good.
#[must_use]
pub fn page_list_problem(answer: &str, count: f64) -> Option<String> {
    if is_all_pages(answer) {
        return None;
    }
    let PageSelection {
        pages,
        out_of_range,
    } = parse_page_list(answer, count);
    if let Some(page) = out_of_range {
        return Some(format!(
            "Page {page} is outside this PDF, which has {count}."
        ));
    }
    if pages.is_empty() {
        return Some(if count > 1.0 {
            "Enter a page, a list like 1,3-5, or \"all\".".to_owned()
        } else {
            "Enter the page to use.".to_owned()
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_number_a_list_and_ranges_name_their_pages_deduplicated_and_sorted() {
        assert_eq!(parse_page_list("3", 9.0).pages, [3.0]);
        assert_eq!(parse_page_list(" 1 , 3 ,5 ", 9.0).pages, [1.0, 3.0, 5.0]);
        assert_eq!(parse_page_list("1-3", 9.0).pages, [1.0, 2.0, 3.0]);
        assert_eq!(
            parse_page_list("1, 3-5, 2", 9.0).pages,
            [1.0, 2.0, 3.0, 4.0, 5.0]
        );
        assert_eq!(parse_page_list("2-2", 9.0).pages, [2.0]);
    }

    #[test]
    fn an_open_ended_or_reversed_range_is_read_generously() {
        // "4-" names everything from 4 to the last page.
        assert_eq!(parse_page_list("4-", 6.0).pages, [4.0, 5.0, 6.0]);
        assert_eq!(selected_pdf_pages("2-", 3.0), [2.0, 3.0]);
        assert_eq!(parse_page_list(" -3", 9.0).pages, [1.0, 2.0, 3.0]);
        // Either way round: the writer meant the same three pages.
        assert_eq!(parse_page_list("5-3", 9.0).pages, [3.0, 4.0, 5.0]);
    }

    #[test]
    fn junk_is_skipped_rather_than_thrown() {
        assert_eq!(parse_page_list("1,x,3", 9.0).pages, [1.0, 3.0]);
        assert!(parse_page_list("", 9.0).pages.is_empty());
        assert!(parse_page_list(",,,", 9.0).pages.is_empty());
        assert!(parse_page_list("0", 9.0).pages.is_empty());
        assert!(parse_page_list("-", 9.0).pages.is_empty());
    }

    #[test]
    fn all_means_every_page_and_only_bounds_apply_after_it() {
        assert!(is_all_pages("all"));
        assert!(is_all_pages(" ALL "));
        assert!(!is_all_pages("all 3"));
        assert_eq!(selected_pdf_pages("all", 4.0), [1.0, 2.0, 3.0, 4.0]);
        // A list is filtered to the pages the document actually has.
        assert_eq!(selected_pdf_pages("1,3-9", 4.0), [1.0, 3.0, 4.0]);
    }

    #[test]
    fn the_validation_line_names_the_page_that_is_out_of_range() {
        assert_eq!(page_list_problem("1,3-5", 8.0), None);
        assert_eq!(page_list_problem("all", 8.0), None);
        assert_eq!(
            page_list_problem("1,9", 8.0).as_deref(),
            Some("Page 9 is outside this PDF, which has 8.")
        );
        assert_eq!(
            page_list_problem("???", 8.0).as_deref(),
            Some("Enter a page, a list like 1,3-5, or \"all\".")
        );
        assert_eq!(
            page_list_problem("2", 1.0).as_deref(),
            Some("Page 2 is outside this PDF, which has 1.")
        );
    }

    #[test]
    fn a_huge_range_is_bounded_by_the_page_count_not_walked() {
        assert_eq!(selected_pdf_pages("1-99999999", 3.0), [1.0, 2.0, 3.0]);
        assert_eq!(selected_pdf_pages("2-999999999999", 2.0), [2.0]);
        assert_eq!(
            page_list_problem("1-99999999", 3.0).as_deref(),
            Some("Page 4 is outside this PDF, which has 3.")
        );
        assert_eq!(
            page_list_problem("5-", 3.0).as_deref(),
            Some("Page 5 is outside this PDF, which has 3.")
        );
        assert_eq!(
            page_list_problem("3-9", 8.0).as_deref(),
            Some("Page 9 is outside this PDF, which has 8.")
        );
    }
}
