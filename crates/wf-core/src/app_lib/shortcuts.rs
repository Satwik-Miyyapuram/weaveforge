//! Whether the keyboard shortcuts sheet is open after a request (TS `nextShortcutsOpen`).

/// A toggle request flips the sheet; any other request (or none) opens it.
#[must_use]
pub fn next_shortcuts_open(open: bool, how: Option<&str>) -> bool {
    if how == Some("toggle") { !open } else { true }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toggle_flips_the_sheet() {
        assert!(!next_shortcuts_open(true, Some("toggle")));
        assert!(next_shortcuts_open(false, Some("toggle")));
    }

    #[test]
    fn other_requests_open_it() {
        assert!(next_shortcuts_open(false, Some("open")));
        assert!(next_shortcuts_open(true, Some("open")));
        assert!(next_shortcuts_open(false, None));
        assert!(next_shortcuts_open(true, Some("TOGGLE")));
    }
}
