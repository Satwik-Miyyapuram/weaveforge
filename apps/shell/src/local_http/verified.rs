//! Whether the local API can serve the open folder. 0.9.8 has no local database:
//! a chosen folder is always files, and no folder, or a device the "install 0.9.7 first"
//! gate holds, means every SDK, MCP, vault and search route is 503.

use std::sync::Arc;

use crate::vault::VaultState;

/// Whether the "install 0.9.7 first" gate passes right now.
pub type GateCheck = Arc<dyn Fn() -> bool + Send + Sync>;

/// A gate that always passes.
#[cfg(test)]
#[must_use]
pub fn open_gate() -> GateCheck {
    Arc::new(|| true)
}

/// Asks `gate` on a blocking thread: it reads files that can sit on a slow or unplugged drive.
/// A gate that panics passes, as the gate fails open.
pub async fn gate_passes(gate: &GateCheck) -> bool {
    let gate = Arc::clone(gate);
    tokio::task::spawn_blocking(move || gate())
        .await
        .unwrap_or(true)
}

/// The storage path for the open folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Workspace files only. SQL is never run.
    Files,
    /// No folder is open, or the install gate holds: every SDK and MCP route answers 503.
    Unavailable,
}

/// `Files` when a folder is open and `gate_passes` (asked only then), else `Unavailable`.
#[must_use]
pub fn folder_mode(vault: &VaultState, gate_passes: impl FnOnce() -> bool) -> Mode {
    let open = vault.lock().root().is_some();
    if open && gate_passes() {
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
        assert_eq!(folder_mode(&VaultState::new(), || true), Mode::Unavailable);
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
        assert_eq!(folder_mode(&vault, || true), Mode::Files);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_open_folder_behind_the_install_gate_is_unavailable() {
        let root = std::env::temp_dir().join(format!("wf-shell-gated-{}", std::process::id()));
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
        assert_eq!(folder_mode(&vault, || false), Mode::Unavailable);
        let _ = fs::remove_dir_all(&root);
    }

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(future)
    }

    #[test]
    fn the_gate_answer_is_passed_through() {
        assert!(block_on(gate_passes(&open_gate())));
        let shut: GateCheck = Arc::new(|| false);
        assert!(!block_on(gate_passes(&shut)));
    }

    #[test]
    fn a_gate_that_panics_passes() {
        let broken: GateCheck = Arc::new(|| panic!("gate broke"));
        assert!(block_on(gate_passes(&broken)));
    }

    #[test]
    fn no_folder_never_asks_the_gate() {
        let asked = std::cell::Cell::new(false);
        let mode = folder_mode(&VaultState::new(), || {
            asked.set(true);
            true
        });
        assert_eq!(mode, Mode::Unavailable);
        assert!(!asked.get());
    }
}
