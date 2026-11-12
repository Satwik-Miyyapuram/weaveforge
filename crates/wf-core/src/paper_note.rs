//! Appending an AI-suggested addition to a paper's note. Pure.
//! Port of `appendPaperNote` in `packages/core/src/features/ai-assistant/domain/parts.ts`.

/// The note after `addition` is appended, with a blank line between the existing text and the
/// new one. The addition is trimmed; the existing note is trimmed too, and an empty note is
/// replaced rather than prefixed. `None` when `addition` is blank, so the caller can refuse it.
#[must_use]
pub fn append_paper_note(existing: Option<&str>, addition: &str) -> Option<String> {
    let next = addition.trim();
    if next.is_empty() {
        return None;
    }
    match existing
        .map(str::trim)
        .filter(|current| !current.is_empty())
    {
        Some(current) => Some(format!("{current}\n\n{next}")),
        None => Some(next.to_owned()),
    }
}

// No TS test found for this module; cases come from the doc comments.
#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "test code"
)]
mod tests {
    use super::*;

    #[test]
    fn appends_with_blank_line_and_trims_both_sides() {
        assert_eq!(
            append_paper_note(Some("  Old  "), " New "),
            Some("Old\n\nNew".to_owned())
        );
    }

    #[test]
    fn empty_or_missing_note_is_replaced_not_prefixed() {
        assert_eq!(
            append_paper_note(Some("   "), "New"),
            Some("New".to_owned())
        );
        assert_eq!(append_paper_note(None, "New"), Some("New".to_owned()));
    }

    #[test]
    fn blank_addition_is_refused() {
        assert_eq!(append_paper_note(Some("Old"), "   "), None);
        assert_eq!(append_paper_note(None, ""), None);
    }
}
