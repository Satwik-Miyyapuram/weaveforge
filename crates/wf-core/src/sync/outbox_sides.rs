//! The base and local sides a conflict opens on, from the ops a device still owes for a row.
//! Ports the selection in `ConflictStore.openFor`, `openDeletedRemote` and `openDeletedLocal`
//! in `apps/web/src/features/offline-sync/domain/parts-1.ts`. The SQL reads of
//! `sync_outbox` stay in TypeScript; this module only picks the sides.

#[cfg(feature = "specta")]
use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// The verb of an outbox op.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum OutboxOp {
    /// A row created on this device.
    Insert,
    /// An edit to a row.
    Update,
    /// A delete of a row.
    Delete,
}

/// One op a device still owes for a row. Slices of these are oldest first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OwedOp {
    /// The verb of the op.
    pub op: OutboxOp,
    /// The row as the op carries it.
    #[cfg_attr(feature = "specta", specta(type = HashMap<String, specta_typescript::Unknown>))]
    pub payload: Map<String, Value>,
    /// The row the op was based on. `None` for an insert.
    #[cfg_attr(feature = "specta", specta(type = Option<HashMap<String, specta_typescript::Unknown>>))]
    pub base_payload: Option<Map<String, Value>>,
}

/// A conflict's two sides: what the row was based on, and this device's state.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Sides {
    /// The base the first owed edit started from. Empty when unknown.
    #[cfg_attr(feature = "specta", specta(type = HashMap<String, specta_typescript::Unknown>))]
    pub base: Map<String, Value>,
    /// This device's latest state of the row.
    #[cfg_attr(feature = "specta", specta(type = HashMap<String, specta_typescript::Unknown>))]
    pub local: Map<String, Value>,
}

/// The ops that are not deletes, which is what an edit conflict is built from.
fn live(ops: &[OwedOp]) -> Vec<&OwedOp> {
    ops.iter().filter(|op| op.op != OutboxOp::Delete).collect()
}

/// The base an op list starts from: the first op's base, or empty when it has none.
fn base_of(op: Option<&OwedOp>) -> Map<String, Value> {
    op.and_then(|op| op.base_payload.clone())
        .unwrap_or_default()
}

/// Sides for an edit conflict (`openFor`). The first non-delete op supplies the base and
/// the last supplies the local state. `None` when no non-delete op is owed.
#[must_use]
pub fn edit_sides(ops: &[OwedOp]) -> Option<Sides> {
    let live = live(ops);
    let first = *live.first()?;
    let last = *live.last()?;
    Some(Sides {
        base: base_of(Some(first)),
        local: last.payload.clone(),
    })
}

/// Sides for a conflict where the row was deleted on the server (`openDeletedRemote`).
/// `stored` is this device's row as it now reads, when the row still exists locally.
/// Falls back to the last owed payload. `None` when neither is available.
#[must_use]
pub fn deleted_remote_sides(ops: &[OwedOp], stored: Option<Map<String, Value>>) -> Option<Sides> {
    let live = live(ops);
    let local = match stored {
        Some(row) => row,
        None => live.last()?.payload.clone(),
    };
    Some(Sides {
        base: base_of(live.first().copied()),
        local,
    })
}

/// The base for a conflict where the row was deleted here (`openDeletedLocal`). Unlike
/// the other two, this reads the first op of any kind, deletes included.
#[must_use]
pub fn deleted_local_base(ops: &[OwedOp]) -> Map<String, Value> {
    base_of(ops.first())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{OutboxOp, OwedOp, deleted_local_base, deleted_remote_sides, edit_sides};

    fn op(kind: OutboxOp, payload: serde_json::Value, base: Option<serde_json::Value>) -> OwedOp {
        OwedOp {
            op: kind,
            payload: (match payload {
                serde_json::Value::Object(map) => Some(map),
                _ => None,
            })
            .unwrap_or_default(),
            base_payload: base.map(|b| b.as_object().cloned().unwrap_or_default()),
        }
    }

    #[test]
    fn edit_sides_take_first_base_and_last_local_skipping_deletes() {
        let ops = vec![
            op(OutboxOp::Update, json!({"t": "b"}), Some(json!({"t": "a"}))),
            op(OutboxOp::Delete, json!({}), None),
            op(OutboxOp::Update, json!({"t": "c"}), Some(json!({"t": "b"}))),
        ];
        let sides = edit_sides(&ops).expect("sides");
        assert_eq!(sides.base.get("t"), Some(&json!("a")));
        assert_eq!(sides.local.get("t"), Some(&json!("c")));
    }

    #[test]
    fn edit_sides_none_when_only_deletes_are_owed() {
        let ops = vec![op(OutboxOp::Delete, json!({}), None)];
        assert!(edit_sides(&ops).is_none());
    }

    #[test]
    fn insert_without_base_reads_as_empty_base() {
        let ops = vec![op(OutboxOp::Insert, json!({"t": "x"}), None)];
        let sides = edit_sides(&ops).expect("sides");
        assert!(sides.base.is_empty());
    }

    #[test]
    fn deleted_remote_prefers_stored_row_over_last_payload() {
        let ops = vec![op(
            OutboxOp::Update,
            json!({"t": "owed"}),
            Some(json!({"t": "base"})),
        )];
        let stored = json!({"t": "stored"}).as_object().cloned();
        let sides = deleted_remote_sides(&ops, stored).expect("sides");
        assert_eq!(sides.local.get("t"), Some(&json!("stored")));
        assert_eq!(sides.base.get("t"), Some(&json!("base")));
    }

    #[test]
    fn deleted_remote_falls_back_to_last_payload_then_none() {
        let ops = vec![op(OutboxOp::Update, json!({"t": "owed"}), None)];
        let sides = deleted_remote_sides(&ops, None).expect("sides");
        assert_eq!(sides.local.get("t"), Some(&json!("owed")));
        assert!(deleted_remote_sides(&[], None).is_none());
    }

    #[test]
    fn deleted_local_base_reads_first_op_even_when_delete() {
        let ops = vec![op(OutboxOp::Delete, json!({}), Some(json!({"t": "a"})))];
        assert_eq!(deleted_local_base(&ops).get("t"), Some(&json!("a")));
        assert!(deleted_local_base(&[]).is_empty());
    }
}
