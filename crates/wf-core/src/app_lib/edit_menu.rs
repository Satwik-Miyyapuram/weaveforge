//! Which desktop menu commands are edit commands (TS `isEditCommand` in `desktop/menu-edit.ts`).

/// The edit commands the shell runs through `document.execCommand`, besides paste.
pub const EXEC_EDIT_COMMANDS: [&str; 5] = [
    "edit-undo",
    "edit-redo",
    "edit-cut",
    "edit-copy",
    "edit-select-all",
];

/// True for paste and for each command in [`EXEC_EDIT_COMMANDS`].
#[must_use]
pub fn is_edit_command(command: &str) -> bool {
    command == "edit-paste" || EXEC_EDIT_COMMANDS.contains(&command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paste_and_exec_commands_are_edit_commands() {
        assert!(is_edit_command("edit-paste"));
        for command in EXEC_EDIT_COMMANDS {
            assert!(is_edit_command(command));
        }
    }

    #[test]
    fn other_commands_are_not_edit_commands() {
        assert!(!is_edit_command("action:docs"));
        assert!(!is_edit_command("edit-delete"));
        assert!(!is_edit_command(""));
        assert!(!is_edit_command("EDIT-COPY"));
    }
}
