//! Character-level cleanups for pasted prose.
//!
//! All three rules convert toward plain ASCII, which is the direction that
//! repairs pasted Markdown rather than breaking it: straight quotes and hyphens
//! are what Markdown's own syntax is made of, and a LaTeX export of a note full
//! of curly quotes and en dashes is a stream of encoding surprises.
//!
//! Offsets are byte offsets into the input. Every pattern is written from
//! escape strings, because the whole point of these rules is that the
//! characters are invisible or easily confused on screen.

use std::sync::LazyLock;

use regex_lite::Regex;

use super::TextResult;
use super::markdown_ranges::{
    frontmatter_range, markdown_code_ranges, markdown_syntax_ranges, math_ranges,
};
use super::text_range::{RangeIndex, TextRange, index_ranges};
use crate::papers::js_regex::compile;

/// A long dash opening a line, after any blockquote and list markers. Matched
/// against the source line, where a long dash cannot yet be mistaken for one.
static LINE_OPENING_DASH: LazyLock<Option<Regex>> = LazyLock::new(|| {
    compile("^((?: {0,3}>[ \t]?)* {0,3}(?:[-*+][ \t]+|\\d{1,9}[.)][ \t]+)?)[\u{2013}\u{2014}]").ok()
});

/// One hyphen and a space is a bullet; two or more alone underline the
/// paragraph above as a setext heading.
static BULLET_OR_RULE: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^(?:-(?:[ \t]|$)|-{2,}[ \t]*$)").ok());

/// Markdown reads four or more leading columns as a code block.
const INDENTED_CODE_COLUMNS: usize = 4;

/// The spans a quote or dash rule must not reach into.
fn protected_for_character_rules(text: &str, extra: &[TextRange]) -> RangeIndex {
    let mut ranges = extra.to_vec();
    ranges.extend(markdown_code_ranges(text));
    ranges.extend(math_ranges(text));
    ranges.extend(markdown_syntax_ranges(text));
    ranges.extend(frontmatter_range(text));
    index_ranges(&ranges)
}

/// Rebuilds `text`, swapping each character `replacement` maps unless a range protects it.
fn replace_unprotected(
    text: &str,
    ranges: &RangeIndex,
    replacement: impl Fn(char) -> Option<&'static str>,
) -> String {
    let mut out = String::with_capacity(text.len());
    for (offset, ch) in text.char_indices() {
        match replacement(ch) {
            Some(with) if !ranges.overlaps(offset, offset + ch.len_utf8()) => out.push_str(with),
            _ => out.push(ch),
        }
    }
    out
}

/// The characters `normalize_invisible_characters` rewrites: exotic spaces become
/// a plain space, the soft hyphen, zero-width space, byte-order mark and the two
/// bidirectional overrides are dropped. Joiners and direction marks are kept.
fn invisible_replacement(ch: char) -> Option<&'static str> {
    match ch {
        '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{202F}' | '\u{205F}' => Some(" "),
        '\u{AD}' | '\u{200B}' | '\u{FEFF}' | '\u{202D}' | '\u{202E}' => Some(""),
        _ => None,
    }
}

/// Curly double and single quotes, mapped to their straight forms.
fn straight_quote(ch: char) -> Option<&'static str> {
    match ch {
        '\u{201C}' | '\u{201D}' | '\u{201E}' | '\u{201F}' => Some("\""),
        '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}' => Some("'"),
        _ => None,
    }
}

/// Replaces the characters that look ordinary and are not: exotic spaces become
/// plain spaces, zero-width characters and bidirectional overrides are dropped.
///
/// Runs before every other rule, because a no-break space is not whitespace to a
/// regular expression — leaving one in would defeat the blank-line and
/// indentation detection the rejoin depends on.
///
/// Code is deliberately *not* protected here. An invisible character inside a
/// pasted code block is exactly the bug this rule exists to remove, and it is
/// the one place where the reader cannot see it at all.
#[must_use]
pub fn normalize_invisible_characters(text: &str, extra: &[TextRange]) -> TextResult {
    // Link targets and frontmatter values carry the character as part of a name
    // or of data, so a no-break space inside them stays.
    let mut ranges = extra.to_vec();
    ranges.extend(markdown_syntax_ranges(text));
    ranges.extend(frontmatter_range(text));
    let ranges = index_ranges(&ranges);
    let out = replace_unprotected(text, &ranges, invisible_replacement);
    TextResult::new(text, out)
}

/// Turns curly quotes and apostrophes into straight ones.
#[must_use]
pub fn straighten_quotes(text: &str, extra: &[TextRange]) -> TextResult {
    let ranges = protected_for_character_rules(text, extra);
    let out = replace_unprotected(text, &ranges, straight_quote);
    TextResult::new(text, out)
}

/// Turns em and en dashes into hyphens.
///
/// Runs after the rejoin, never before it: a hyphen is a list marker, so a line
/// opening with a converted long dash would read as a bullet and the paragraph
/// it belongs to would refuse to rejoin — and would then render as a list.
/// A converted dash that still lands at the start of a line is escaped for the
/// same reason.
#[must_use]
pub fn straighten_dashes(text: &str, extra: &[TextRange]) -> TextResult {
    let ranges = protected_for_character_rules(text, extra);
    let dashed = replace_unprotected(text, &ranges, |ch| {
        matches!(ch, '\u{2013}' | '\u{2014}').then_some("-")
    });

    let source_lines: Vec<&str> = text.split('\n').collect();
    let out: Vec<String> = dashed
        .split('\n')
        .enumerate()
        .map(|(index, line)| {
            let source = source_lines.get(index).copied().unwrap_or("");
            escape_opening_dash(line, source)
        })
        .collect();
    TextResult::new(text, out.join("\n"))
}

/// Escapes a converted dash opening a line, so it is not read as a list item.
fn escape_opening_dash(line: &str, source: &str) -> String {
    let Some(opening) = LINE_OPENING_DASH
        .as_ref()
        .and_then(|re| re.captures(source))
    else {
        return line.to_owned();
    };
    let prefix = opening.get(1).map_or("", |m| m.as_str());
    let Some(tail) = line.strip_suffix('\r').unwrap_or(line).get(prefix.len()..) else {
        return line.to_owned();
    };
    let is_bullet_or_rule = BULLET_OR_RULE.as_ref().is_some_and(|re| re.is_match(tail));
    match line.get(prefix.len()..) {
        Some(rest) if is_bullet_or_rule => format!("{prefix}\\{rest}"),
        _ => line.to_owned(),
    }
}

/// Removes blank lines and stray spaces around a paste without touching the
/// blank lines inside it, which are paragraph breaks the writer meant.
///
/// The leading indent is the subtle one. Four columns in front of the first line
/// is not stray whitespace, it is an indented code block — and stripping it
/// turns code into prose, which the quote and dash rules then rewrite on the
/// *next* pass because the protection went with the indent. Anything under four
/// columns cannot carry that meaning at the start of a paste, so it goes.
#[must_use]
pub fn trim_surrounding_whitespace(text: &str) -> TextResult {
    // Blank lines may carry spaces, so each one is consumed whole, in one pass.
    let mut rest = text;
    while let Some(after) = rest.trim_start_matches([' ', '\t']).strip_prefix('\n') {
        rest = after;
    }

    let mut out = rest.trim_end_matches([' ', '\t', '\n']).to_owned();

    let mut columns = 0_usize;
    let mut indent_bytes = 0_usize;
    for ch in out.chars() {
        match ch {
            ' ' => columns += 1,
            '\t' => columns += INDENTED_CODE_COLUMNS,
            _ => break,
        }
        indent_bytes += 1;
    }
    if indent_bytes > 0 && columns < INDENTED_CODE_COLUMNS {
        out.replace_range(..indent_bytes, "");
    }
    TextResult::new(text, out)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    const ZERO_WIDTH: &str = "\u{200B}";
    const NO_BREAK: &str = "\u{A0}";
    const CURLY: &str = "\u{201C}It works,\u{201D} she said \u{2014} finally.";

    #[test]
    fn normalises_assistant_typography_to_plain_text() {
        let quotes = straighten_quotes(CURLY, &[]).text;
        assert_eq!(
            straighten_dashes(&quotes, &[]).text,
            "\"It works,\" she said - finally."
        );
    }

    #[test]
    fn removes_zero_width_and_turns_exotic_spaces_into_plain_ones() {
        let text = format!("a{ZERO_WIDTH}b{NO_BREAK}c");
        let result = normalize_invisible_characters(&text, &[]);
        assert_eq!(result.text, "ab c");
        assert!(result.changed);
    }

    #[test]
    fn keeps_the_joiners_that_hold_letters_and_emoji_together() {
        let joined = "\u{928}\u{94D}\u{200D}\u{92F} and \u{1F468}\u{200D}\u{1F4BB}";
        assert_eq!(normalize_invisible_characters(joined, &[]).text, joined);
    }

    #[test]
    fn an_invisible_character_inside_code_is_still_removed() {
        let text = format!("`a{ZERO_WIDTH}b`");
        assert_eq!(normalize_invisible_characters(&text, &[]).text, "`ab`");
    }

    #[test]
    fn quotes_and_dashes_inside_code_maths_and_links_survive() {
        let code = "`don\u{2019}t` here\n\n```\na \u{2014} b\n```";
        assert_eq!(straighten_quotes(code, &[]).text, code);
        assert_eq!(straighten_dashes(code, &[]).text, code);

        let maths = "The bound $\\alpha \u{2014} \\beta$ holds";
        assert_eq!(straighten_dashes(maths, &[]).text, maths);

        let link = "[[2013\u{2013}14 season]] and [a](https://x.example/\u{201C}q\u{201D})";
        assert_eq!(straighten_dashes(link, &[]).text, link);
        assert_eq!(straighten_quotes(link, &[]).text, link);
    }

    #[test]
    fn a_citation_command_keeps_its_key() {
        let cite = "as shown \\cite{smith\u{2013}2019} and [@a\u{2019}b]";
        assert_eq!(straighten_dashes(cite, &[]).text, cite);
        assert_eq!(straighten_quotes(cite, &[]).text, cite);
    }

    #[test]
    fn frontmatter_values_are_data_not_prose() {
        let note = "---\ntitle: \u{201C}A \u{2014} B\u{201D}\n---\n\nBody \u{2014} here";
        assert_eq!(
            straighten_dashes(note, &[]).text,
            "---\ntitle: \u{201C}A \u{2014} B\u{201D}\n---\n\nBody - here"
        );
    }

    #[test]
    fn a_converted_leading_dash_is_escaped_so_it_is_not_a_list_item() {
        assert_eq!(
            straighten_dashes("\u{2014} finally", &[]).text,
            "\\- finally"
        );
        assert_eq!(
            straighten_dashes("word \u{2014} finally", &[]).text,
            "word - finally"
        );
    }

    #[test]
    fn trimming_keeps_the_blank_lines_inside_a_paste() {
        let result = trim_surrounding_whitespace("\n\n  one\n\ntwo  \n\n");
        assert_eq!(result.text, "one\n\ntwo");
    }

    #[test]
    fn trimming_settles_in_one_pass_when_a_blank_line_carries_spaces() {
        let once = trim_surrounding_whitespace("a\n\n   \n\n").text;
        assert_eq!(once, "a");
        assert_eq!(trim_surrounding_whitespace(&once).text, once);
    }

    #[test]
    fn trimming_leaves_an_indented_code_block_at_the_top_alone() {
        let block = "    const a = \u{201C}x\u{201D} \u{2014} 1;";
        assert_eq!(trim_surrounding_whitespace(block).text, block);
        let padded = format!("\n\n{block}\n\n");
        assert_eq!(trim_surrounding_whitespace(&padded).text, block);
        assert_eq!(
            trim_surrounding_whitespace("   three spaces").text,
            "three spaces"
        );
    }

    #[test]
    fn trimming_the_end_keeps_inner_runs_and_carriage_returns() {
        let cases: [(&str, &str); 5] = [
            ("a  \n \t\n  ", "a"),
            ("a\r\n\r\n", "a\r\n\r"),
            ("      ", ""),
            ("    code  \n\n", "    code"),
            ("a\n\n\nb \t", "a\n\n\nb"),
        ];
        for (input, expected) in cases {
            assert_eq!(
                trim_surrounding_whitespace(input).text,
                expected,
                "{input:?}"
            );
        }
        let run = format!("a{}b", "\n".repeat(40_000));
        assert_eq!(trim_surrounding_whitespace(&run).text, run);
    }

    #[test]
    fn empty_input_is_unchanged_by_every_rule() {
        for result in [
            normalize_invisible_characters("", &[]),
            straighten_quotes("", &[]),
            straighten_dashes("", &[]),
            trim_surrounding_whitespace(""),
        ] {
            assert_eq!(result.text, "");
            assert!(!result.changed);
        }
    }

    #[test]
    fn every_pattern_compiles() {
        assert!(LINE_OPENING_DASH.is_some(), "LINE_OPENING_DASH");
        assert!(BULLET_OR_RULE.is_some(), "BULLET_OR_RULE");
    }
}
