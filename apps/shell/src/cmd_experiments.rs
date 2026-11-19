//! Files-first experiments (0.9.5 L4): stores SDK inbox rows as files.
//!
//! The page fetches claimed rows (`GET /api/sdk/inbox`) with its session,
//! hands them here, and acks (`POST /api/sdk/inbox/ack`) only the ids this
//! returns. A row is acked only once its data is on disk; a row fetched again
//! after a lost ack is found on disk and acked again without a second copy.

use serde_json::Value;
use wf_store::files::metrics_csv::{apply_inbox_rows, experiment_dirs};

use crate::commands::{Json, ShellError};
use crate::vault::VaultState;

/// What one drain stored.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InboxDrainReply {
    /// Rows handed in.
    pub batches: u32,
    /// Inbox row ids (numbers) whose data is on disk; post these to the ack route.
    pub acked: Json,
    /// Files that were already on disk (a row fetched again after a lost ack).
    pub duplicates: u32,
    /// Rows left in the inbox, each with the reason.
    pub skipped: Vec<String>,
}

/// Writes claimed SDK inbox rows into the experiment folders and returns the
/// ids that are safe to ack.
///
/// # Errors
/// No folder chosen, or the workspace cannot be listed.
#[tauri::command]
#[specta::specta]
pub async fn sdk_inbox_drain(
    state: tauri::State<'_, VaultState>,
    rows: Vec<Json>,
) -> Result<InboxDrainReply, ShellError> {
    let rows = crate::commands::json_params(rows)?;
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || drain(&state, &rows))
        .await
        .unwrap_or_else(|_| Err(crate::cmd_files::TASK_FAILED.to_owned()))
        .map_err(ShellError::from)
}

fn drain(state: &VaultState, rows: &[Value]) -> Result<InboxDrainReply, String> {
    let session = state.lock();
    let vault = session.vault()?;
    let dirs = experiment_dirs(vault).map_err(|e| e.to_string())?;
    let report = apply_inbox_rows(vault, rows, &dirs);
    let acked = serde_json::from_value(Value::from(report.ack)).map_err(|e| e.to_string())?;
    Ok(InboxDrainReply {
        batches: u32::try_from(rows.len()).unwrap_or(u32::MAX),
        acked,
        duplicates: u32::try_from(report.duplicates).unwrap_or(u32::MAX),
        skipped: report
            .skipped
            .into_iter()
            .map(|(id, reason)| match id {
                Some(id) => format!("{id}: {reason}"),
                None => reason,
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use serde_json::json;

    use super::*;

    struct Fixture {
        root: PathBuf,
        vault: VaultState,
    }

    impl Fixture {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "wf-shell-inbox-drain-{}-{name}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(root.join(".weaveforge")).expect("create workspace");
            fs::create_dir_all(root.join("experiments")).expect("create experiments");
            fs::write(
                root.join("experiments").join("sweep.md"),
                "---\nweaveforge-id: exp-1\nweaveforge-type: experiment\nwf: 3\n---\n",
            )
            .expect("write experiment");
            let vault = VaultState::new();
            assert!(
                vault
                    .lock()
                    .adopt(Some(root.as_path()))
                    .expect("adopt workspace")
                    .is_some()
            );
            Self { root, vault }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn row(id: i64) -> Value {
        json!({"id": id, "kind": "metrics", "payload": {"points": [
            {"experiment_id": "exp-1", "metric": "loss", "step": id, "value": 0.1}
        ]}})
    }

    #[test]
    fn drain_then_ack_names_stored_rows_only() {
        let fixture = Fixture::new("ack");
        let rows = [
            row(4),
            json!({"id": 5, "kind": "metrics", "payload": {}}),
            row(6),
        ];
        let reply = drain(&fixture.vault, &rows).expect("drain");
        assert_eq!(reply.batches, 3);
        assert_eq!(serde_json::to_value(&reply.acked).ok(), Some(json!([4, 6])));
        assert_eq!(reply.skipped.len(), 1);
        assert!(reply.skipped[0].starts_with("5: "), "{:?}", reply.skipped);
    }

    #[test]
    fn ack_lost_refetch_acks_again_without_a_copy() {
        let fixture = Fixture::new("refetch");
        let _ = drain(&fixture.vault, &[row(4)]).expect("first drain");
        let again = drain(&fixture.vault, &[row(4)]).expect("second drain");
        assert_eq!(serde_json::to_value(&again.acked).ok(), Some(json!([4])));
        assert_eq!(again.duplicates, 1);
    }

    #[test]
    fn no_folder_is_an_error() {
        assert!(drain(&VaultState::new(), &[row(1)]).is_err());
    }
}
