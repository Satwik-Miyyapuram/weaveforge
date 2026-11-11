//! The row or the action a reader's choice produces (`ConflictStore.resolveWith` and
//! `resolveDeletion` in `apps/web/src/features/offline-sync/domain/parts-1.ts`). The outbox
//! and `sync_*` SQL calls stay in TypeScript; this module only decides what they should do.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::conflict_deletion::{DeleteConflictKind, DeletionChoice};
use super::merge::merge_rows;

/// The side a field pick keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum FieldSide {
    /// Keep this device's value for the field.
    Local,
    /// Keep the server's value for the field.
    Remote,
}

/// The row a field-by-field resolution writes: the merge, with each picked-local field
/// taken from local (removed when local lacks it), then the overrides applied last.
#[must_use]
pub fn resolve_with_row(
    base: &Map<String, Value>,
    local: &Map<String, Value>,
    remote: &Map<String, Value>,
    picks: &HashMap<String, FieldSide>,
    overrides: Option<&Map<String, Value>>,
) -> Map<String, Value> {
    let mut chosen = merge_rows(base, local, remote).merged;
    for (field, side) in picks {
        if *side != FieldSide::Local {
            continue;
        }
        match local.get(field) {
            Some(value) => {
                let _ = chosen.insert(field.clone(), value.clone());
            }
            None => {
                let _ = chosen.remove(field);
            }
        }
    }
    if let Some(overrides) = overrides {
        for (field, value) in overrides {
            let _ = chosen.insert(field.clone(), value.clone());
        }
    }
    chosen
}

/// The storage action a delete conflict's choice calls for. The TypeScript caller runs the
/// matching outbox and `sync_*` SQL.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "ConflictDeletionAction"))]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum DeletionAction {
    /// Send the local row again whole, with its id, as an insert.
    ResendLocal {
        /// The row to send, carrying its `id`.
        #[cfg_attr(feature = "specta", specta(type = std::collections::HashMap<String, specta_typescript::Unknown>))]
        payload: Map<String, Value>,
    },
    /// Let the server's delete stand on this device.
    AcceptRemoteDelete,
    /// Drop this device's pending ops for the row and queue the delete.
    DeleteLocally,
    /// Bring the server's copy back onto this device.
    RestoreRemote {
        /// The server's row to store locally.
        #[cfg_attr(feature = "specta", specta(type = std::collections::HashMap<String, specta_typescript::Unknown>))]
        remote: Map<String, Value>,
    },
    /// Nothing to store: the server has no copy to restore.
    Nothing,
}

/// The action for a delete conflict of `kind` settled with `choice`. `local` is this
/// device's row, `row_id` its id and `remote` the server's copy, if one was kept.
#[must_use]
pub fn deletion_action(
    kind: DeleteConflictKind,
    choice: DeletionChoice,
    local: &Map<String, Value>,
    row_id: &str,
    remote: Option<&Map<String, Value>>,
) -> DeletionAction {
    match (kind, choice) {
        (DeleteConflictKind::DeletedRemote, DeletionChoice::Keep) => {
            let mut payload = local.clone();
            let _ = payload.insert("id".to_owned(), Value::String(row_id.to_owned()));
            DeletionAction::ResendLocal { payload }
        }
        (DeleteConflictKind::DeletedRemote, DeletionChoice::Delete) => {
            DeletionAction::AcceptRemoteDelete
        }
        (DeleteConflictKind::DeletedLocal, DeletionChoice::Delete) => DeletionAction::DeleteLocally,
        (DeleteConflictKind::DeletedLocal, DeletionChoice::Keep) => match remote {
            Some(remote) => DeletionAction::RestoreRemote {
                remote: remote.clone(),
            },
            None => DeletionAction::Nothing,
        },
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use serde_json::json;

    use super::{DeletionAction, FieldSide, deletion_action, resolve_with_row};
    use crate::sync::conflict_deletion::{DeleteConflictKind, DeletionChoice};

    fn row(value: serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
        (match value {
            serde_json::Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
    }

    #[test]
    fn local_pick_takes_local_value_over_merge() {
        let base = row(json!({"t": "a", "n": 1}));
        let local = row(json!({"t": "b", "n": 1}));
        let remote = row(json!({"t": "c", "n": 1}));
        let mut picks = HashMap::new();
        let _ = picks.insert("t".to_owned(), FieldSide::Local);
        let chosen = resolve_with_row(&base, &local, &remote, &picks, None);
        assert_eq!(chosen.get("t"), Some(&json!("b")));
    }

    #[test]
    fn remote_pick_keeps_server_value() {
        let base = row(json!({"t": "a"}));
        let local = row(json!({"t": "b"}));
        let remote = row(json!({"t": "c"}));
        let mut picks = HashMap::new();
        let _ = picks.insert("t".to_owned(), FieldSide::Remote);
        let chosen = resolve_with_row(&base, &local, &remote, &picks, None);
        assert_eq!(chosen.get("t"), Some(&json!("c")));
    }

    #[test]
    fn local_pick_of_absent_field_removes_it() {
        let base = row(json!({"t": "a", "gone": 1}));
        let local = row(json!({"t": "a"}));
        let remote = row(json!({"t": "a", "gone": 2}));
        let mut picks = HashMap::new();
        let _ = picks.insert("gone".to_owned(), FieldSide::Local);
        let chosen = resolve_with_row(&base, &local, &remote, &picks, None);
        assert!(!chosen.contains_key("gone"));
    }

    #[test]
    fn overrides_apply_last() {
        let base = row(json!({"t": "a"}));
        let local = row(json!({"t": "b"}));
        let remote = row(json!({"t": "c"}));
        let overrides = row(json!({"t": "d"}));
        let chosen = resolve_with_row(&base, &local, &remote, &HashMap::new(), Some(&overrides));
        assert_eq!(chosen.get("t"), Some(&json!("d")));
    }

    #[test]
    fn deleted_remote_keep_resends_local_with_id() {
        let local = row(json!({"t": "mine"}));
        let action = deletion_action(
            DeleteConflictKind::DeletedRemote,
            DeletionChoice::Keep,
            &local,
            "row-1",
            None,
        );
        match action {
            DeletionAction::ResendLocal { payload } => {
                assert_eq!(payload.get("id"), Some(&json!("row-1")));
                assert_eq!(payload.get("t"), Some(&json!("mine")));
            }
            other => panic!("expected resend, got {other:?}"),
        }
    }

    #[test]
    fn deleted_remote_delete_accepts_remote_delete() {
        let local = row(json!({}));
        let action = deletion_action(
            DeleteConflictKind::DeletedRemote,
            DeletionChoice::Delete,
            &local,
            "row-1",
            None,
        );
        assert_eq!(action, DeletionAction::AcceptRemoteDelete);
    }

    #[test]
    fn deleted_local_delete_drops_locally() {
        let local = row(json!({}));
        let action = deletion_action(
            DeleteConflictKind::DeletedLocal,
            DeletionChoice::Delete,
            &local,
            "row-1",
            None,
        );
        assert_eq!(action, DeletionAction::DeleteLocally);
    }

    #[test]
    fn deleted_local_keep_restores_remote_or_nothing() {
        let local = row(json!({}));
        let remote = row(json!({"t": "server"}));
        let restored = deletion_action(
            DeleteConflictKind::DeletedLocal,
            DeletionChoice::Keep,
            &local,
            "row-1",
            Some(&remote),
        );
        assert_eq!(
            restored,
            DeletionAction::RestoreRemote {
                remote: remote.clone()
            }
        );
        let none = deletion_action(
            DeleteConflictKind::DeletedLocal,
            DeletionChoice::Keep,
            &local,
            "row-1",
            None,
        );
        assert_eq!(none, DeletionAction::Nothing);
    }
}
