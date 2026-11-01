//! The paste pipeline. Port of `packages/core/src/paste/clean-pasted-text.ts`.
//!
//! Order matters more than any single rule here, and the reasons are all interference between
//! rules:
//!
//!  1. Invisible characters first, because a no-break space is not whitespace to a regular
//!     expression, and one left in place defeats every blank-line and indentation test that
//!     follows.
//!  2. Links next, while the text still has the exact spelling that was copied.
//!  3. The wrap repair, which needs line structure intact.
//!  4. Dashes last, because a hyphen is a list marker: converting a leading long dash before
//!     step 3 turns a wrapped sentence into a list item.
//!
//! Nothing here fetches anything. Every rule is a pure function of the clipboard text and the
//! settings.

use serde::Serialize;
use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

use crate::search::js_text::{is_js_whitespace, utf16_len};

use super::control_characters::strip_control_sequences;
use super::markdown_ranges::markdown_code_ranges;
use super::paste_settings::PasteSettings;
use super::pdf_text::{PdfTextOptions, clean_pdf_text};
use super::scholarly_links::link_scholarly_identifiers;
use super::tabular_text::tab_separated_to_markdown_table;
use super::typography::{
    normalize_invisible_characters, straighten_dashes, straighten_quotes,
    trim_surrounding_whitespace,
};
use super::url_cleanup::{build_url_cleanup_options, clean_urls_in_text, http_url_ranges};

/// The outcome of the automatic paste rules.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CleanPasteResult {
    /// The text after the rules ran.
    pub text: String,
    /// True when `text` differs from the input.
    pub changed: bool,
    /// How many links were shortened, for a caller that wants to say so.
    pub urls_cleaned: u32,
}

/// True when a paste at `offset` (a byte offset, on a char boundary) must not be cleaned.
///
/// Inside a fenced block, an inline code span or frontmatter, the pasted text is being shown
/// rather than written, and every rule here would be changing the evidence.
#[must_use]
pub fn paste_lands_in_verbatim_context(document: &str, offset: usize) -> bool {
    let offset = offset.min(document.len());
    if markdown_code_ranges(document)
        .iter()
        .any(|range| offset > range.start && offset < range.end)
    {
        return true;
    }
    // Frontmatter is checked by line rather than by the block range, so that a paste at the
    // very end of an unclosed opening block counts too.
    if !starts_with_frontmatter_fence(document) {
        return false;
    }
    let before = document.get(..offset).unwrap_or(document);
    before
        .split('\n')
        .filter(|line| is_frontmatter_delimiter(line))
        .count()
        == 1
}

/// Runs the automatic rules a paste is entitled to under `settings`.
#[must_use]
pub fn clean_pasted_text(input: &str, settings: &PasteSettings) -> CleanPasteResult {
    if !settings.clean_on_paste {
        return CleanPasteResult {
            text: input.to_string(),
            changed: false,
            urls_cleaned: 0,
        };
    }

    let mut text = input.replace("\r\n", "\n").replace('\r', "\n");
    let mut urls_cleaned: u32 = 0;

    if settings.strip_escape_sequences {
        text = strip_control_sequences(&text);
    }

    if settings.normalize_invisible {
        text = normalize_invisible_characters(&text, &[]).text;
    }

    // Before the line-based rules: a spreadsheet's rows are already a structure, and the wrap
    // repair would try to rejoin them into a paragraph.
    if settings.tabs_to_table {
        text = tab_separated_to_markdown_table(&text).text;
    }

    if settings.clean_links {
        let result = clean_urls_in_text(
            &text,
            &build_url_cleanup_options(&settings.link_removals),
            &[],
        );
        text = result.text;
        urls_cleaned = result.count;
    }

    if settings.clean_pdf_on_paste && looks_like_pdf_text(&text) {
        let options = PdfTextOptions {
            remove_page_numbers: false,
            single_paragraph: false,
        };
        text = clean_pdf_text(&text, &options).text;
    }

    // A URL is a name, so neither character rule may reach into one.
    let mut urls = http_url_ranges(&text);

    // The links it writes are then protected from the dash rule like any other.
    if settings.link_identifiers {
        let linked = link_scholarly_identifiers(&text, &urls);
        if linked.count > 0 {
            text = linked.text;
            urls = http_url_ranges(&text);
        }
    }

    if settings.straighten_quotes {
        text = straighten_quotes(&text, &urls).text;
    }
    if settings.straighten_dashes {
        text = straighten_dashes(&text, &urls).text;
    }

    if settings.trim_whitespace {
        text = trim_surrounding_whitespace(&text).text;
    }

    let changed = text != input;
    CleanPasteResult {
        text,
        changed,
        urls_cleaned,
    }
}

/// A guess at whether text came out of a PDF, used only when the reader has asked for the
/// repair to run on every paste.
///
/// The evidence is a ligature glyph, a soft hyphen, or several short lines in a row where at
/// least one ends with a hyphen.
#[must_use]
pub fn looks_like_pdf_text(text: &str) -> bool {
    if text
        .chars()
        .any(|ch| ('\u{FB00}'..='\u{FB06}').contains(&ch) || ch == '\u{AD}')
    {
        return true;
    }

    let lines: Vec<&str> = text
        .split('\n')
        .filter(|line| !line.trim_matches(is_js_whitespace).is_empty())
        .collect();
    if lines.len() < 3 {
        return false;
    }

    let trimmed: Vec<&str> = lines
        .iter()
        .map(|line| line.trim_end_matches(is_js_whitespace))
        .collect();
    let hyphenated = trimmed
        .iter()
        .filter(|line| ends_with_letter_hyphen(line))
        .count();
    if hyphenated == 0 {
        return false;
    }

    let lengths: Vec<usize> = trimmed.iter().map(|line| utf16_len(line)).collect();
    let longest = lengths.iter().copied().fold(0, usize::max);
    // A wrapped column: the lines cluster at one width rather than varying freely.
    // `length >= longest - 12`, written without underflow.
    let near_longest = lengths
        .iter()
        .filter(|&&length| length + 12 >= longest)
        .count();
    longest <= 110 && near_longest * 2 >= lines.len()
}

/// `/[\p{L}]-$/u` on an already right-trimmed line.
fn ends_with_letter_hyphen(line: &str) -> bool {
    line.strip_suffix('-')
        .and_then(|head| head.chars().next_back())
        .is_some_and(|ch| ch.general_category_group() == GeneralCategoryGroup::Letter)
}

/// `^ {0,3}` followed by the rest of the line, or `None` when indented four or more spaces.
fn indent_of_up_to_three(line: &str) -> Option<&str> {
    let rest = line.trim_start_matches(' ');
    if line.len() - rest.len() > 3 {
        None
    } else {
        Some(rest)
    }
}

/// `/^ {0,3}---[ \t]*(\n|$)/` tested against the whole document.
fn starts_with_frontmatter_fence(document: &str) -> bool {
    let Some(rest) = indent_of_up_to_three(document).and_then(|rest| rest.strip_prefix("---"))
    else {
        return false;
    };
    let rest = rest.trim_start_matches([' ', '\t']);
    rest.is_empty() || rest.starts_with('\n')
}

/// `/^ {0,3}(?:---|\.\.\.)[ \t]*$/` tested against one line.
fn is_frontmatter_delimiter(line: &str) -> bool {
    let Some(rest) = indent_of_up_to_three(line) else {
        return false;
    };
    let Some(rest) = rest
        .strip_prefix("---")
        .or_else(|| rest.strip_prefix("..."))
    else {
        return false;
    };
    rest.trim_matches([' ', '\t']).is_empty()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn defaults_repair_without_house_style() {
        // Tracker gone, zero-width gone, blank line gone; quotes and dashes kept.
        let input = "\n  Read https://a.example/x?utm_source=news\u{200B} \
                     \u{201C}now\u{201D} \u{2014} today  \n";
        let result = clean_pasted_text(input, &PasteSettings::default());
        assert_eq!(
            result.text,
            "Read https://a.example/x \u{201C}now\u{201D} \u{2014} today"
        );
        assert_eq!(result.urls_cleaned, 1);
        assert!(result.changed);
    }

    #[test]
    fn master_switch_returns_the_clipboard_untouched() {
        let raw = "  https://a.example/x?utm_source=news  ";
        let settings = PasteSettings {
            clean_on_paste: false,
            ..PasteSettings::default()
        };
        let result = clean_pasted_text(raw, &settings);
        assert_eq!(result.text, raw);
        assert!(!result.changed);
        assert_eq!(result.urls_cleaned, 0);
    }

    #[test]
    fn quotes_and_dashes_run_once_on_and_stay_out_of_a_url() {
        let settings = PasteSettings {
            straighten_quotes: true,
            straighten_dashes: true,
            ..PasteSettings::default()
        };
        let input = "\u{201C}don\u{2019}t\u{201D} \u{2014} https://a.example/2013\u{2013}2014";
        let result = clean_pasted_text(input, &settings);
        assert_eq!(
            result.text,
            "\"don't\" - https://a.example/2013\u{2013}2014"
        );
    }

    #[test]
    fn empty_input_is_unchanged() {
        let result = clean_pasted_text("", &PasteSettings::default());
        assert_eq!(result.text, "");
        assert!(!result.changed);
        assert_eq!(result.urls_cleaned, 0);
    }

    #[test]
    fn non_ascii_prose_without_repairs_is_unchanged() {
        let input = "caf\u{E9} \u{2014} na\u{EF}ve \u{201C}quote\u{201D}";
        let settings = PasteSettings {
            trim_whitespace: false,
            ..PasteSettings::default()
        };
        let result = clean_pasted_text(input, &settings);
        assert_eq!(result.text, input);
        assert!(!result.changed);
    }

    #[test]
    fn paste_inside_code_or_frontmatter_is_left_alone() {
        let document = "intro\n\n```\nlet x = 1;\n```\n";
        let inside_fence = document.find("let x").unwrap();
        assert!(paste_lands_in_verbatim_context(document, inside_fence));
        assert!(!paste_lands_in_verbatim_context(document, 2));

        let note = "---\ntitle: A\n---\n\nbody";
        assert!(paste_lands_in_verbatim_context(
            note,
            note.find("title").unwrap()
        ));
        assert!(!paste_lands_in_verbatim_context(
            note,
            note.find("body").unwrap()
        ));
    }

    #[test]
    fn offset_past_the_end_is_clamped() {
        let note = "---\ntitle: A\n---\n\nbody";
        assert!(!paste_lands_in_verbatim_context(note, note.len() + 100));
    }

    #[test]
    fn pdf_text_is_recognised_by_its_wrapping() {
        assert!(looks_like_pdf_text(
            "The findings suggest that long-term expo-\n\
             sure has a measurable effect on the out-\n\
             come in both groups."
        ));
        assert!(!looks_like_pdf_text("a short note\nwith two lines"));
        // Ligature U+FB01 and soft hyphen U+00AD are each enough on their own.
        assert!(looks_like_pdf_text("The \u{FB01}nancial effect"));
        assert!(looks_like_pdf_text("co\u{AD}operate"));
    }

    #[test]
    fn pdf_check_handles_empty_and_blank_input() {
        assert!(!looks_like_pdf_text(""));
        assert!(!looks_like_pdf_text("\n   \n\t\n"));
    }
}
