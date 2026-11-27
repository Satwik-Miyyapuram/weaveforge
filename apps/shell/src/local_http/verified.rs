//! Whether the local API can serve the open folder. 0.9.8 has no local database:
//! a chosen folder is always files; no folder means every SDK, MCP, vault and search route is 503.

use crate::vault::VaultState;

/// The storage path for the open folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Workspace files only. SQL is never run.
    Files,
    /// No folder is open: every SDK and MCP route answers 503.
    Unavailable,
}

/// `Files` when a folder is open, else `Unavailable`.
#[must_use]
pub fn folder_mode(vault: &VaultState) -> Mode {
    if vault.lock().root().is_some() {
        Mode::Files
    } else {
        Mode::Unavailable
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn no_folder_is_unavailable() {
        assert_eq!(folder_mode(&VaultState::new()), Mode::Unavailable);
    }

    #[test]
    fn an_open_folder_is_files_without_any_migration_report() {
        let root = std::env::temp_dir().join(format!("wf-shell-verified-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create folder");
        let vault = VaultState::new();
        assert!(
            vault
                .lock()
                .adopt(Some(root.as_path()))
                .expect("adopt")
                .is_some()
        );
        assert_eq!(folder_mode(&vault), Mode::Files);
        let _ = fs::remove_dir_all(&root);
    }
}
