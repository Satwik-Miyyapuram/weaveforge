//! Heading anchor ids (wf-core `heading_slug`). Ported from `apps/web/src/lib/heading-slug.ts`.
//! Saved `[[Note#Heading]]` links depend on this output, so it must stay exactly the same.

use crate::search::js_text::{is_js_whitespace, is_letter_or_number};

/// The anchor id for a heading: trimmed, lowercased, every run of non-letters and non-digits
/// one hyphen, and no leading or trailing hyphen.
#[must_use]
pub fn heading_slug(text: &str) -> String {
    let lower = text.trim_matches(is_js_whitespace).to_lowercase();
    let mut out = String::with_capacity(lower.len());
    for ch in lower.chars() {
        if is_letter_or_number(ch) {
            out.push(ch);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_heading() {
        assert_eq!(heading_slug("Hello World"), "hello-world");
    }

    #[test]
    fn punctuation_runs_collapse_and_trim() {
        assert_eq!(heading_slug("  --Intro: a/b?!--  "), "intro-a-b");
    }

    #[test]
    fn digits_and_unicode_letters_kept() {
        assert_eq!(heading_slug("Section 2 Ünïcode"), "section-2-ünïcode");
    }

    #[test]
    fn empty_and_symbol_only_are_empty() {
        assert_eq!(heading_slug(""), "");
        assert_eq!(heading_slug("!!! ???"), "");
    }

    #[test]
    fn combining_marks_are_separators() {
        // U+0301 is a mark (not \p{L}\p{N}), so it splits the word like JS does.
        assert_eq!(heading_slug("cafe\u{301}s"), "cafe-s");
    }

    #[test]
    fn js_trim_removes_nbsp_and_bom() {
        assert_eq!(heading_slug("\u{a0}\u{feff}Title\u{3000}"), "title");
    }
}
