//! Deciding how an open conflict settles when the server's row arrives (`ConflictStore.settle`),
//! and the row-equality check `write` uses. Ports the decision in
//! `apps/web/src/features/offline-sync/domain/parts-1.ts`. The SQL that stores each outcome
//! stays in TypeScript.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::merge::{Conflict, merge_rows, same_value};

/// The kind of an open conflict, as `sync_conflicts.kind` stores it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum OpenConflictKind {
    /// Both sides edited the row.
    Edit,
    /// Deleted on the server while this device still had edits.
    DeletedRemote,
    /// Deleted on this device while the server still had the row.
    DeletedLocal,
}

/// What `settle` does with a row that just arrived from the server.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "ConflictSettlePlan"))]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum SettlePlan {
    /// Keep the server copy as the restore target. The row stays deleted locally.
    StoreRemote,
    /// The sides merge without disagreement. Write the merged row and resolve the conflict.
    Merged {
        /// The merged row to write.
        #[cfg_attr(feature = "specta", specta(type = std::collections::HashMap<String, specta_typescript::Unknown>))]
        merged: Map<String, Value>,
        /// Whether the conflict kind flips back to `edit` before the write.
        restore_edit: bool,
    },
    /// Some fields disagree. Store the server row and the field conflicts, left open.
    Open {
        /// The fields the reader must decide.
        conflicts: Vec<Conflict>,
        /// Whether the conflict kind flips back to `edit` before the store.
        restore_edit: bool,
    },
}

/// The settle decision for a conflict of `kind`, given its base and local sides and the
/// server's row. A deleted-here conflict only keeps the server copy; the others merge.
#[must_use]
pub fn settle_plan(
    kind: OpenConflictKind,
    base: &Map<String, Value>,
    local: &Map<String, Value>,
    remote: &Map<String, Value>,
) -> SettlePlan {
    if kind == OpenConflictKind::DeletedLocal {
        return SettlePlan::StoreRemote;
    }
    let restore_edit = kind == OpenConflictKind::DeletedRemote;
    let result = merge_rows(base, local, remote);
    if result.conflicts.is_empty() {
        SettlePlan::Merged {
            merged: result.merged,
            restore_edit,
        }
    } else {
        SettlePlan::Open {
            conflicts: result.conflicts,
            restore_edit,
        }
    }
}

/// Whether two rows hold the same value for every field. A missing field and a null one
/// compare equal (`sameRow` in `conflicts.ts`).
#[must_use]
pub fn same_row(a: &Map<String, Value>, b: &Map<String, Value>) -> bool {
    let null = Value::Null;
    a.keys().chain(b.keys()).all(|key| {
        let left = a.get(key).unwrap_or(&null);
        let right = b.get(key).unwrap_or(&null);
        same_value(left, right)
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{OpenConflictKind, SettlePlan, same_row, settle_plan};

    fn row(value: serde_json::Value) -> serde_json::Map<String, serde_json::Value> {
        (match value {
            serde_json::Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
    }

    #[test]
    fn deleted_local_keeps_server_copy_only() {
        let base = row(json!({"t": "a"}));
        let plan = settle_plan(OpenConflictKind::DeletedLocal, &base, &base, &base);
        assert_eq!(plan, SettlePlan::StoreRemote);
    }

    #[test]
    fn clean_merge_writes_merged_and_flips_deleted_remote_back_to_edit() {
        let base = row(json!({"t": "a", "n": 1}));
        let local = row(json!({"t": "b", "n": 1}));
        let remote = row(json!({"t": "a", "n": 2}));
        match settle_plan(OpenConflictKind::DeletedRemote, &base, &local, &remote) {
            SettlePlan::Merged {
                merged,
                restore_edit,
            } => {
                assert_eq!(merged.get("t"), Some(&json!("b")));
                assert_eq!(merged.get("n"), Some(&json!(2)));
                assert!(restore_edit);
            }
            other => panic!("expected merged, got {other:?}"),
        }
    }

    #[test]
    fn same_field_disagreement_stays_open_with_conflicts() {
        let base = row(json!({"t": "a"}));
        let local = row(json!({"t": "b"}));
        let remote = row(json!({"t": "c"}));
        match settle_plan(OpenConflictKind::Edit, &base, &local, &remote) {
            SettlePlan::Open {
                conflicts,
                restore_edit,
            } => {
                assert_eq!(conflicts.len(), 1);
                assert_eq!(conflicts[0].field, "t");
                assert!(!restore_edit);
            }
            other => panic!("expected open, got {other:?}"),
        }
    }

    #[test]
    fn same_row_treats_missing_and_null_alike() {
        assert!(same_row(
            &row(json!({"a": 1})),
            &row(json!({"a": 1, "b": null}))
        ));
        assert!(!same_row(&row(json!({"a": 1})), &row(json!({"a": 2}))));
    }
}
