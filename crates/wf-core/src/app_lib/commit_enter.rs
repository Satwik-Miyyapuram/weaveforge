//! Whether a key event commits a field: Enter, outside an IME composition (TS `isCommitEnter`).

/// True for Enter that is not part of an IME composition. Key code 229 is the IME marker, so it
/// does not count; a missing key code does.
#[must_use]
pub fn is_commit_enter(key: &str, key_code: Option<u32>, is_composing: bool) -> bool {
    key == "Enter" && !is_composing && key_code != Some(229)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_enter_commits() {
        assert!(is_commit_enter("Enter", None, false));
        assert!(is_commit_enter("Enter", Some(13), false));
    }

    #[test]
    fn composing_or_ime_enter_does_not_commit() {
        assert!(!is_commit_enter("Enter", Some(13), true));
        assert!(!is_commit_enter("Enter", Some(229), false));
    }

    #[test]
    fn other_keys_do_not_commit() {
        assert!(!is_commit_enter("a", Some(65), false));
        assert!(!is_commit_enter("Escape", None, false));
    }
}
