//! Whether a key press belongs to a text field (wf-core `editor_workspace::typing_target`). Parity
//! with `isTypingTarget` in `apps/web/src/features/editor-workspace/application/parts.ts`.
//! The DOM target is read by the shell; this is the rule on its tag name and editability.

/// Whether a key press should be left to the field it is typed into: an `input`, `textarea` or
/// `select`. A contenteditable element owns its keys, so it is never a typing target here.
#[must_use]
pub fn is_typing_target(tag_name: Option<&str>, is_content_editable: bool) -> bool {
    if is_content_editable {
        return false;
    }
    let tag = tag_name.unwrap_or("").to_lowercase();
    matches!(tag.as_str(), "input" | "textarea" | "select")
}

#[cfg(test)]
mod tests {
    use super::is_typing_target;

    #[test]
    fn form_fields_are_typing_targets_whatever_the_case() {
        assert!(is_typing_target(Some("INPUT"), false));
        assert!(is_typing_target(Some("textarea"), false));
        assert!(is_typing_target(Some("Select"), false));
    }

    #[test]
    fn contenteditable_and_other_elements_are_not() {
        assert!(!is_typing_target(Some("textarea"), true));
        assert!(!is_typing_target(Some("div"), false));
        assert!(!is_typing_target(None, false));
    }
}
