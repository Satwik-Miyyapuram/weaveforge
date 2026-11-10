//! Blank-document rule for model concept extraction (TS `ModelConceptExtractor.extract`).
//!
//! A document with only whitespace has nothing to extract, so the batch loop skips it.

use crate::search::js_text::is_js_whitespace;

/// True when the document has text other than JavaScript whitespace.
///
/// Matches `(doc.text ?? "").trim() !== ""`: a missing text counts as blank.
#[must_use]
pub fn has_text(text: Option<&str>) -> bool {
    text.is_some_and(|value| !value.trim_matches(is_js_whitespace).is_empty())
}

#[cfg(test)]
mod tests {
    use super::has_text;

    #[test]
    fn missing_or_blank_text_has_no_text() {
        assert!(!has_text(None));
        assert!(!has_text(Some("")));
        assert!(!has_text(Some(" \t\r\n ")));
        // Non-breaking space and BOM are JS whitespace, so they do not count.
        assert!(!has_text(Some("\u{00A0}\u{FEFF}")));
    }

    #[test]
    fn any_non_whitespace_counts() {
        assert!(has_text(Some("a")));
        assert!(has_text(Some("  note  ")));
    }
}
