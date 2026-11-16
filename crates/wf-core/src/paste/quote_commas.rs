//! Comma placement next to a closing quotation mark.
//!
//! American style puts the comma inside the quotation and British style puts it
//! outside; journals disagree and a thesis has to pick one. Neither is a default
//! worth imposing, so this only runs when a writer asks for it on a selection.
//!
//! The guards are what make it safe. A comma next to a quote is far more often
//! data than prose — CSV fields, JSON objects, a list of quoted words — and
//! moving one there corrupts the value silently.

use serde::Deserialize;
use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

use super::TextResult;
use super::markdown_ranges::{
    frontmatter_range, markdown_code_ranges, markdown_syntax_ranges, math_ranges,
};
use super::text_range::{RangeIndex, index_ranges};

/// Which side of a closing double quote the comma goes on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum CommaPlacement {
    /// Inside the closing quotation mark (American style).
    Inside,
    /// Outside the closing quotation mark (British style).
    Outside,
}

/// Straight-quote parity of the current line, walked forward once. Matches
/// arrive in order, so rescanning from each line start would go quadratic.
#[derive(Default)]
struct QuoteParity {
    scanned: usize,
    open: bool,
}

impl QuoteParity {
    /// True when an odd number of straight quotes on the line precede `offset`.
    fn open_at(&mut self, input: &str, offset: usize) -> bool {
        if offset > self.scanned {
            if let Some(span) = input.get(self.scanned..offset) {
                for ch in span.chars() {
                    if ch == '\n' {
                        self.open = false;
                    } else if ch == '"' {
                        self.open = !self.open;
                    }
                }
            }
            self.scanned = offset;
        }
        self.open
    }
}

/// True for the closing quotes the pattern accepts: straight and right double.
fn is_closing_quote(ch: char) -> bool {
    matches!(ch, '"' | '\u{201D}')
}

/// True for a letter or mark, as JS `\p{L}\p{M}` sees one UTF-16 unit.
fn is_letter_or_mark(ch: char) -> bool {
    ch.len_utf16() == 1
        && matches!(
            ch.general_category_group(),
            GeneralCategoryGroup::Letter | GeneralCategoryGroup::Mark
        )
}

/// True when `first` and `second` form a candidate match for `placement`.
fn is_comma_pair(placement: CommaPlacement, first: char, second: char) -> bool {
    match placement {
        CommaPlacement::Inside => is_closing_quote(first) && second == ',',
        CommaPlacement::Outside => first == ',' && is_closing_quote(second),
    }
}

/// Decides whether the candidate spanning `span` moves its comma, applying the guards.
fn should_move(
    input: &str,
    ranges: &RangeIndex,
    span: (usize, usize),
    quote: char,
    parity: &mut QuoteParity,
) -> bool {
    let (offset, end) = span;
    if ranges.overlaps(offset, end) {
        return false;
    }

    // Quoted prose must end right before the match: for `inside` the quote has
    // to close a word, for `outside` the comma has to follow one. A digit does
    // not count — a straight quote after a number is an inch mark or an
    // attribute value, not a quotation.
    let before = input
        .get(..offset)
        .and_then(|head| head.chars().next_back());
    if !before.is_some_and(is_letter_or_mark) {
        return false;
    }

    // Only mid-sentence, where a plain space follows. A quote or comma next
    // means CSV fields, a tab means a TSV row, a line end means a row of
    // either, and a letter means a missing space before a new quotation.
    let Some(after) = input.get(end..) else {
        return false;
    };
    if !after.starts_with(' ') {
        return false;
    }

    // A quote or bracket after that space reads as the next value in
    // single-line JSON just as well as an enumeration of quoted words.
    let after_space = after.get(1..).and_then(|rest| rest.chars().next());
    if after_space.is_some_and(|ch| matches!(ch, '"' | '\u{201C}' | '\u{201D}' | '[' | '{')) {
        return false;
    }

    // A straight quote has no direction, so it only closes a quotation when an
    // earlier one on the line opened it. Without that the match sits at a field
    // boundary, as in: name," John Smith",age
    if quote == '"' && !parity.open_at(input, offset) {
        return false;
    }

    true
}

/// Moves commas to the chosen side of a closing double quote.
#[must_use]
pub fn apply_comma_placement(input: &str, placement: CommaPlacement) -> TextResult {
    let mut ranges = markdown_code_ranges(input);
    ranges.extend(math_ranges(input));
    ranges.extend(markdown_syntax_ranges(input));
    ranges.extend(frontmatter_range(input));
    let ranges = index_ranges(&ranges);

    let mut parity = QuoteParity::default();
    let mut out = String::with_capacity(input.len());
    let mut chars = input.char_indices().peekable();
    while let Some((offset, first)) = chars.next() {
        let Some(&(_, second)) = chars.peek() else {
            out.push(first);
            continue;
        };
        if !is_comma_pair(placement, first, second) {
            out.push(first);
            continue;
        }
        let _second = chars.next();

        let end = offset + first.len_utf8() + second.len_utf8();
        let quote = match placement {
            CommaPlacement::Inside => first,
            CommaPlacement::Outside => second,
        };
        if should_move(input, &ranges, (offset, end), quote, &mut parity) {
            match placement {
                CommaPlacement::Inside => {
                    out.push(',');
                    out.push(first);
                }
                CommaPlacement::Outside => {
                    out.push(second);
                    out.push(',');
                }
            }
        } else {
            out.push(first);
            out.push(second);
        }
    }
    TextResult::new(input, out)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn moves_the_comma_outside_a_closing_quote() {
        assert_eq!(
            apply_comma_placement(
                "She called it \"finished,\" then left.",
                CommaPlacement::Outside
            )
            .text,
            "She called it \"finished\", then left."
        );
    }

    #[test]
    fn moves_the_comma_inside_a_closing_quote() {
        assert_eq!(
            apply_comma_placement(
                "She called it \"finished\", then left.",
                CommaPlacement::Inside
            )
            .text,
            "She called it \"finished,\" then left."
        );
    }

    #[test]
    fn csv_and_json_are_data_and_stay_exactly_as_they_are() {
        let csv = "name,\"John Smith\", age";
        assert_eq!(
            apply_comma_placement(csv, CommaPlacement::Outside).text,
            csv
        );
        let json = "{\"name\":\"Anna\", \"city\":\"Berg\"}";
        assert_eq!(
            apply_comma_placement(json, CommaPlacement::Outside).text,
            json
        );
    }

    #[test]
    fn straight_quote_parity_is_tracked_per_line() {
        assert_eq!(
            apply_comma_placement("say \"a\", b\", c", CommaPlacement::Inside).text,
            "say \"a,\" b\", c"
        );
        assert_eq!(
            apply_comma_placement("x \"a\nb\", c", CommaPlacement::Inside).text,
            "x \"a\nb\", c"
        );
        assert_eq!(
            apply_comma_placement("x \"a\ny \"b\", c", CommaPlacement::Inside).text,
            "x \"a\ny \"b,\" c"
        );
        assert_eq!(
            apply_comma_placement("say \"a,\" b", CommaPlacement::Outside).text,
            "say \"a\", b"
        );
    }

    #[test]
    fn non_ascii_letters_before_the_quote_count_as_prose() {
        assert_eq!(
            apply_comma_placement("say \"café\", b", CommaPlacement::Inside).text,
            "say \"café,\" b"
        );
    }

    #[test]
    fn a_curly_closing_quote_moves_without_parity_check() {
        assert_eq!(
            apply_comma_placement("say \u{201C}a\u{201D}, b", CommaPlacement::Inside).text,
            "say \u{201C}a,\u{201D} b"
        );
    }

    #[test]
    fn empty_input_is_unchanged() {
        let result = apply_comma_placement("", CommaPlacement::Inside);
        assert_eq!(result.text, "");
        assert!(!result.changed);
    }

    #[test]
    fn parity_walk_stays_linear_on_a_long_line() {
        let line = "x\", y ".repeat(40_000);
        let out = apply_comma_placement(&line, CommaPlacement::Inside).text;
        assert_eq!(out, "x\", y x,\" y ".repeat(20_000));
    }
}
