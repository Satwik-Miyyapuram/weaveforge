//! Quotations as note markdown (TS `formatQuoteBlock` and `formatQuoteCiteClipboard`).
//!
//! A highlight's text is the PDF's text layer, so it is repaired before it is
//! quoted: wrapped lines are joined, hyphenated words are mended, and page
//! numbers are kept, since a lone number in a highlight may be data. Each line
//! then becomes a `> ` line, with a bare `>` for a blank line so no trailing
//! space is written.

use crate::paste::pdf_text::{PdfTextOptions, clean_pdf_text};
use crate::search::js_text::is_js_whitespace;

/// Neither guess is safe without a person to confirm it, so both stay off.
const QUOTE_REPAIR: PdfTextOptions = PdfTextOptions {
    remove_page_numbers: false,
    single_paragraph: false,
};

/// The repaired quote as `> ` lines, with no trailing newline.
#[must_use]
pub fn format_quote_block(quote: &str) -> String {
    let normalized = quote.replace("\r\n", "\n").replace('\r', "\n");
    let repaired = clean_pdf_text(&normalized, &QUOTE_REPAIR).text;
    repaired
        .trim_matches(is_js_whitespace)
        .split('\n')
        .map(|line| {
            if line.is_empty() {
                ">".to_owned()
            } else {
                format!("> {line}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The quote block, a blank line, then a `[[paper title]]` wikilink and a newline.
#[must_use]
pub fn format_quote_cite_clipboard(quote: &str, paper_title: &str) -> String {
    format!("{}\n\n[[{paper_title}]]\n", format_quote_block(quote))
}

#[cfg(test)]
mod tests {
    use super::{format_quote_block, format_quote_cite_clipboard};

    #[test]
    fn multiline_quote_becomes_quote_lines() {
        assert_eq!(format_quote_block("first\nsecond"), "> first\n> second");
    }

    #[test]
    fn crlf_is_normalised_before_repair() {
        assert_eq!(format_quote_block("first\r\nsecond"), "> first\n> second");
    }

    #[test]
    fn paragraph_break_becomes_bare_marker() {
        assert_eq!(
            format_quote_block("First claim.\n\nSecond claim."),
            "> First claim.\n>\n> Second claim."
        );
    }

    #[test]
    fn cite_clipboard_appends_wikilink() {
        assert_eq!(
            format_quote_cite_clipboard("first\nsecond", "Paper title"),
            "> first\n> second\n\n[[Paper title]]\n"
        );
    }
}
