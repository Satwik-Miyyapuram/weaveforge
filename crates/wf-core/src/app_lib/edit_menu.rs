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

/// The `document.execCommand` id for an edit command, or `None` for paste and anything else
/// (TS `EXEC` map in `desktop/menu-edit.ts`).
#[must_use]
pub fn exec_command_name(command: &str) -> Option<&'static str> {
    match command {
        "edit-undo" => Some("undo"),
        "edit-redo" => Some("redo"),
        "edit-cut" => Some("cut"),
        "edit-copy" => Some("copy"),
        "edit-select-all" => Some("selectAll"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exec_names_map_each_exec_command() {
        assert_eq!(exec_command_name("edit-undo"), Some("undo"));
        assert_eq!(exec_command_name("edit-redo"), Some("redo"));
        assert_eq!(exec_command_name("edit-cut"), Some("cut"));
        assert_eq!(exec_command_name("edit-copy"), Some("copy"));
        assert_eq!(exec_command_name("edit-select-all"), Some("selectAll"));
    }

    #[test]
    fn paste_and_unknown_commands_have_no_exec_name() {
        assert_eq!(exec_command_name("edit-paste"), None);
        assert_eq!(exec_command_name("action:docs"), None);
        assert_eq!(exec_command_name("EDIT-COPY"), None);
    }

    #[test]
    fn every_exec_edit_command_has_an_exec_name() {
        for command in EXEC_EDIT_COMMANDS {
            assert!(exec_command_name(command).is_some());
        }
    }

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
