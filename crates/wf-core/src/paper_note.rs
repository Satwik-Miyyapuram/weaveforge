//! Appending an AI-suggested addition to a paper's note. Pure.
//! Port of `appendPaperNote` in `packages/core/src/features/ai-assistant/domain/ai-write-proposal.ts`.

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
