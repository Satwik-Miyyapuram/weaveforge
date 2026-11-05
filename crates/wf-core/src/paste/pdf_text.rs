//! Repairing text copied out of a PDF.
//!
//! A quotation lifted from a two-column paper arrives as short lines, with words
//! split across them by a hyphen the typesetter added, ligature glyphs where
//! `fi` and `ffl` should be, and a page number sitting in the middle of a
//! sentence. Two fixes cannot be inferred from the text: whether a bare number
//! was a page number or data, and whether the passage was one paragraph. Those
//! are options the caller asks for rather than guesses made here.

use std::sync::LazyLock;

use regex_lite::Regex;
use serde::Deserialize;
use unicode_normalization::UnicodeNormalization;
use unicode_properties::{GeneralCategory, UnicodeGeneralCategory};

use super::TextResult;
use super::markdown_ranges::markdown_code_ranges;
use super::text_range::{TextRange, index_ranges};
use super::wrapped_text::{
    Bullets, PDF_MIN_WRAP_WIDTH, Rejoin, SOFT_HYPHEN, WrappedTextOptions, clean_wrapped_text,
    ends_hyphenated, join_pieces,
};
use crate::papers::js_regex::{compile, space_class};
use crate::search::js_text::{is_js_whitespace, utf16_len};

/// Options for [`clean_pdf_text`].
#[allow(clippy::struct_excessive_bools)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase", default)]
pub struct PdfTextOptions {
    /// Remove page-number lines along with the page break around them.
    pub remove_page_numbers: bool,
    /// Join the whole selection into a single paragraph.
    pub single_paragraph: bool,
}

/// Longest visible content that can plausibly still be a page number, in UTF-16 units.
const PAGE_NUMBER_MAX_LENGTH: usize = 24;

/// En and em dash, the dash forms page numbers use besides the ASCII hyphen.
const DASHES: &str = "\u{2013}\u{2014}";

/// `\s*\d{1,9}[.)]\s` — a numbered list item.
static NUMBERED_ITEM: LazyLock<Option<Regex>> =
    LazyLock::new(|| compile(r"^\s*\d{1,9}[.)]\s").ok());

/// A line whose visible content is digits and page-number separators: `14`,
/// `- 3 -`, `3 / 12`. A whitelist rather than a blacklist, so `95%`, `[12]` and
/// `2 + 2 = 4` stay content.
static PAGE_NUMBER_LINE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    let space = space_class();
    let pattern = format!(r"^[{space}\-{DASHES}.()/|:]*\d[{space}\d\-{DASHES}.()/|:]*$");
    compile(&pattern).ok()
});

/// True when `ch` is a ligature glyph U+FB00 to U+FB06.
fn ligature_for(ch: char) -> Option<&'static str> {
    match ch {
        '\u{FB00}' => Some("ff"),
        '\u{FB01}' => Some("fi"),
        '\u{FB02}' => Some("fl"),
        '\u{FB03}' => Some("ffi"),
        '\u{FB04}' => Some("ffl"),
        // Unicode folds both long-s ligatures to st.
        '\u{FB05}' | '\u{FB06}' => Some("st"),
        _ => None,
    }
}

/// One source line and whether Markdown renders it as code or maths.
struct ClassifiedLine<'a> {
    text: &'a str,
    /// True when the line must pass through untouched.
    verbatim: bool,
}

/// Splits into lines, marking the ones that must pass through untouched. A line
/// with an inline backtick span is prose with code in it, so only a whole line
/// of code is verbatim.
fn classify_lines(text: &str) -> Vec<ClassifiedLine<'_>> {
    // Indexed rather than scanned: a long selection with many code spans would
    // otherwise cost lines times ranges.
    let code = index_ranges(&markdown_code_ranges(text));
    let mut lines = Vec::new();
    let mut start = 0;
    let mut math = false;
    for line in text.split('\n') {
        let end = start + line.len();
        let delimiter = line.trim_matches(is_js_whitespace) == "$$";
        // The strict lower bound keeps a blank line that merely touches a range's
        // endpoint, such as the one after a closing fence, out of the block.
        let covered = code
            .find(start)
            .is_some_and(|range: TextRange| range.end > start && range.end >= end);
        let verbatim = math || delimiter || covered;
        if delimiter {
            math = !math;
        }
        lines.push(ClassifiedLine {
            text: line,
            verbatim,
        });
        start = end + 1;
    }
    lines
}

/// True when the last visible character of `text` ends a sentence or closes a quote.
fn ends_sentence(text: &str) -> bool {
    text.trim_end_matches(is_js_whitespace)
        .chars()
        .next_back()
        .is_some_and(|ch| {
            matches!(
                ch,
                '.' | '!' | '?' | ':' | ';' | '"' | '\'' | '\u{2019}' | '\u{201D}'
            ) || ch == '\u{2026}'
                || ch == ')'
        })
}

/// True when `text` starts with a lowercase letter or an ASCII digit.
fn starts_continuation(text: &str) -> bool {
    text.chars().next().is_some_and(|ch| {
        ch.is_ascii_digit() || ch.general_category() == GeneralCategory::LowercaseLetter
    })
}

/// True when a line is page furniture: digits and separators, nothing else.
fn is_page_number(line: &ClassifiedLine<'_>) -> bool {
    if line.verbatim {
        return false;
    }
    let key = line.text.trim_matches(is_js_whitespace);
    if key.is_empty() || utf16_len(key) > PAGE_NUMBER_MAX_LENGTH {
        return false;
    }
    let compiled: &Option<Regex> = &PAGE_NUMBER_LINE;
    compiled.as_ref().is_some_and(|re| re.is_match(key))
}

/// True when the line starts a numbered list item.
fn is_numbered_item(text: &str) -> bool {
    let compiled: &Option<Regex> = &NUMBERED_ITEM;
    compiled.as_ref().is_some_and(|re| re.is_match(text))
}

/// Removes page-number lines together with the blank lines around them.
///
/// When the text before the gap ends mid-sentence, the gap closes so the rejoin
/// can repair the sentence across the page break; otherwise one blank line stays
/// and the paragraphs remain separate. Running headers and footers are left
/// alone: telling them from repeated content needs page geometry a clipboard
/// never carries.
fn remove_page_numbers(text: &str) -> String {
    let lines = classify_lines(text);
    let mut output: Vec<String> = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let line = &lines[index];
        let blank = line.text.trim_matches(is_js_whitespace).is_empty();
        if line.verbatim || (!blank && !is_page_number(line)) {
            output.push(line.text.to_string());
            index += 1;
            continue;
        }

        // Blank lines and page furniture around one break form a single gap.
        let mut end = index;
        let mut saw_page_number = false;
        while end < lines.len()
            && !lines[end].verbatim
            && (lines[end].text.trim_matches(is_js_whitespace).is_empty()
                || is_page_number(&lines[end]))
        {
            if is_page_number(&lines[end]) {
                saw_page_number = true;
            }
            end += 1;
        }

        if !saw_page_number {
            output.extend(lines[index..end].iter().map(|l| l.text.to_string()));
        } else if let (Some(previous), Some(next)) = (output.last(), lines.get(end)) {
            // A gap at either edge disappears with its furniture. In the middle it
            // closes only when the text reads as one sentence crossing the page.
            let crosses_page = ends_hyphenated(previous)
                || (!ends_sentence(previous)
                    && !next.verbatim
                    && starts_continuation(next.text.trim_start_matches(is_js_whitespace))
                    && !is_numbered_item(next.text));
            if !crosses_page {
                output.push(String::new());
            }
        }
        index = end;
    }
    output.join("\n")
}

/// Joins every prose line into one paragraph, leaving code and maths alone.
fn join_into_one_paragraph(text: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut prose: Vec<String> = Vec::new();
    let mut verbatim: Vec<&str> = Vec::new();

    for line in classify_lines(text) {
        if line.verbatim {
            flush_prose(&mut prose, &mut parts);
            verbatim.push(line.text);
            continue;
        }
        flush_verbatim(&mut verbatim, &mut parts);
        let trimmed = line.text.trim_matches(is_js_whitespace);
        if !trimmed.is_empty() {
            prose.push(trimmed.to_string());
        }
    }
    flush_prose(&mut prose, &mut parts);
    flush_verbatim(&mut verbatim, &mut parts);

    // The blank line keeps an indented code block out of the joined paragraph:
    // Markdown reads an indented line straight after prose as more prose.
    parts.join("\n\n")
}

/// Pushes the joined prose run, if any, and clears it.
fn flush_prose(prose: &mut Vec<String>, parts: &mut Vec<String>) {
    if prose.is_empty() {
        return;
    }
    parts.push(join_pieces(prose));
    prose.clear();
}

/// Pushes the verbatim run, if any, and clears it.
fn flush_verbatim(verbatim: &mut Vec<&str>, parts: &mut Vec<String>) {
    if verbatim.is_empty() {
        return;
    }
    parts.push(verbatim.join("\n"));
    verbatim.clear();
}

/// Drops every soft hyphen except one that sits at a line end. That one stays
/// for the rejoin, which reads it as wrap evidence and removes it there.
fn drop_soft_hyphens(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != SOFT_HYPHEN {
            out.push(ch);
            continue;
        }
        // Matches `(?![ \t]*\n)`: a soft hyphen before spaces and a newline stays.
        let mut lookahead = chars.clone();
        while lookahead.next_if(|c| *c == ' ' || *c == '\t').is_some() {}
        if lookahead.next_if_eq(&'\n').is_none() {
            continue;
        }
        out.push(ch);
    }
    out
}

/// Expands ligatures, repairs hyphenated words, rejoins the lines the layout
/// wrapped, and collapses the spacing justified text leaves behind.
#[must_use]
pub fn clean_pdf_text(input: &str, options: &PdfTextOptions) -> TextResult {
    // Composing combining accents lets the hyphen repair see the letter.
    let composed: String = input.nfc().collect();
    let normalized = composed.replace("\r\n", "\n").replace('\r', "\n");

    let mut expanded = String::with_capacity(normalized.len());
    for ch in normalized.chars() {
        match ligature_for(ch) {
            Some(replacement) => expanded.push_str(replacement),
            None => expanded.push(ch),
        }
    }

    let mut text = drop_soft_hyphens(&expanded);
    if options.remove_page_numbers {
        text = remove_page_numbers(&text);
    }

    let rejoined = clean_wrapped_text(
        &text,
        &WrappedTextOptions {
            rejoin: Rejoin::Any,
            bullets: Bullets::Markdown,
            merge_hyphens: true,
            collapse_spaces: true,
            min_wrap_width: Some(PDF_MIN_WRAP_WIDTH),
            protect_math: true,
        },
    );

    // A soft hyphen that survived sat at a break the rejoin kept, for example in
    // front of a list item, so it goes here instead.
    let mut cleaned = rejoined.text.replace(SOFT_HYPHEN, "");

    if options.single_paragraph {
        cleaned = join_into_one_paragraph(&cleaned);
    }

    TextResult::new(input, cleaned)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    fn default_options() -> PdfTextOptions {
        PdfTextOptions::default()
    }

    #[test]
    fn a_hyphen_the_layout_added_is_repaired_across_the_break() {
        assert_eq!(
            clean_pdf_text("a long-term expo-\nsure", &default_options()).text,
            "a long-term exposure"
        );
    }

    #[test]
    fn ligature_glyphs_expand_to_their_letters() {
        assert_eq!(
            clean_pdf_text(
                "the \u{FB01}nancial e\u{FB00}ect and \u{FB03}x",
                &default_options()
            )
            .text,
            "the financial effect and ffix"
        );
    }

    #[test]
    fn a_page_number_is_kept_by_default_and_removed_when_asked() {
        let text = "the result was\n\n14\n\nmeasured again";
        assert_eq!(clean_pdf_text(text, &default_options()).text, text);
        let removing = PdfTextOptions {
            remove_page_numbers: true,
            single_paragraph: false,
        };
        assert_eq!(
            clean_pdf_text(text, &removing).text,
            "the result was\nmeasured again"
        );
    }

    #[test]
    fn a_percentage_is_data_not_a_page_number() {
        let text = "the rate was\n\n95%\n\nhigher";
        let removing = PdfTextOptions {
            remove_page_numbers: true,
            single_paragraph: false,
        };
        assert_eq!(clean_pdf_text(text, &removing).text, text);
    }

    #[test]
    fn single_paragraph_joins_prose_and_keeps_the_code_block() {
        let text = "first line\n\nsecond line\n\n```\ncode\n```";
        let joining = PdfTextOptions {
            remove_page_numbers: false,
            single_paragraph: true,
        };
        assert_eq!(
            clean_pdf_text(text, &joining).text,
            "first line second line\n\n```\ncode\n```"
        );
    }

    #[test]
    fn block_maths_pass_through_untouched() {
        let text = "the bound\n\n$$\na - b\n$$\n\nholds";
        let result = clean_pdf_text(text, &default_options());
        assert_eq!(result.text, text);
        assert!(!result.changed);
    }

    #[test]
    fn empty_input_is_reported_unchanged() {
        let result = clean_pdf_text("", &default_options());
        assert_eq!(result.text, "");
        assert!(!result.changed);
    }

    #[test]
    fn combining_accents_compose_and_soft_hyphens_inside_words_go() {
        let result = clean_pdf_text("cafe\u{301} exam\u{AD}ple", &default_options());
        assert_eq!(result.text, "caf\u{E9} example");
        assert!(result.changed);
    }

    #[test]
    fn every_pattern_compiles() {
        assert!(NUMBERED_ITEM.is_some(), "NUMBERED_ITEM");
        assert!(PAGE_NUMBER_LINE.is_some(), "PAGE_NUMBER_LINE");
    }
}
