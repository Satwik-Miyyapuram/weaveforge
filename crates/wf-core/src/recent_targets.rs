//! Ports `isRecentTarget` and `pinRecentTargets` in
//! `apps/web/src/lib/parts-2.ts`. localStorage, timestamps and the
//! 15-entry cap stay in TS; only the shape check and the ordering are decided here.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The identity of a jump-list entry: what kind it is and which item it points at.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Deserialize)]
pub struct TargetKey {
    /// The kind of thing opened (`paper`, `note`, `section`).
    pub kind: String,
    /// The id of the thing opened, unique within its kind.
    pub id: String,
}

/// One slot in the pinned list: the index of an item, and whether it is a recent target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PinnedSlot {
    /// Index into the `items` the list was built from.
    pub index: usize,
    /// True when the slot came from the recents list (flagged `recent` in TS).
    pub recent: bool,
}

/// Storage is user-editable: a stored entry is usable only when it is an object
/// with string `kind` and `id` fields.
#[must_use]
pub fn is_recent_target(value: &Value) -> bool {
    value.get("kind").and_then(Value::as_str).is_some()
        && value.get("id").and_then(Value::as_str).is_some()
}

/// The order to show `items` in: recently opened ones first, in visit order and
/// flagged `recent`, then the rest in their own order. A recent target that matches
/// no item is skipped. When items share a key, the last one wins the recent slot
/// (matching the TS `Map` it replaces).
#[must_use]
pub fn pin_recent_targets(items: &[TargetKey], recents: &[TargetKey]) -> Vec<PinnedSlot> {
    let mut by_key: HashMap<&TargetKey, usize> = HashMap::new();
    for (index, item) in items.iter().enumerate() {
        let _ = by_key.insert(item, index);
    }
    let mut pinned: Vec<PinnedSlot> = Vec::new();
    for target in recents {
        if let Some(&index) = by_key.get(target) {
            pinned.push(PinnedSlot {
                index,
                recent: true,
            });
        }
    }
    let pinned_keys: Vec<&TargetKey> = pinned
        .iter()
        .filter_map(|slot| items.get(slot.index))
        .collect();
    for (index, item) in items.iter().enumerate() {
        if !pinned_keys.contains(&item) {
            pinned.push(PinnedSlot {
                index,
                recent: false,
            });
        }
    }
    pinned
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{PinnedSlot, TargetKey, is_recent_target, pin_recent_targets};

    fn key(kind: &str, id: &str) -> TargetKey {
        TargetKey {
            kind: kind.to_owned(),
            id: id.to_owned(),
        }
    }

    #[test]
    fn stored_entry_needs_string_kind_and_id() {
        assert!(is_recent_target(
            &json!({"kind": "paper", "id": "p1", "title": "x"})
        ));
        assert!(!is_recent_target(&json!({"kind": "paper"})));
        assert!(!is_recent_target(&json!({"kind": 1, "id": "p1"})));
        assert!(!is_recent_target(&json!({"kind": "paper", "id": null})));
        assert!(!is_recent_target(&json!("paper")));
        assert!(!is_recent_target(&json!(null)));
        assert!(!is_recent_target(&json!(["paper", "p1"])));
    }

    #[test]
    fn recents_lead_in_visit_order_and_are_flagged() {
        let items = vec![key("note", "n1"), key("paper", "p1"), key("paper", "p2")];
        let recents = vec![key("paper", "p2"), key("note", "n1")];
        assert_eq!(
            pin_recent_targets(&items, &recents),
            vec![
                PinnedSlot {
                    index: 2,
                    recent: true
                },
                PinnedSlot {
                    index: 0,
                    recent: true
                },
                PinnedSlot {
                    index: 1,
                    recent: false
                },
            ]
        );
    }

    #[test]
    fn recent_without_a_matching_item_is_skipped() {
        let items = vec![key("paper", "p1")];
        let recents = vec![key("paper", "gone")];
        assert_eq!(
            pin_recent_targets(&items, &recents),
            vec![PinnedSlot {
                index: 0,
                recent: false
            }]
        );
    }

    #[test]
    fn kind_is_part_of_the_identity() {
        let items = vec![key("paper", "1"), key("note", "1")];
        let recents = vec![key("note", "1")];
        assert_eq!(
            pin_recent_targets(&items, &recents),
            vec![
                PinnedSlot {
                    index: 1,
                    recent: true
                },
                PinnedSlot {
                    index: 0,
                    recent: false
                },
            ]
        );
    }

    #[test]
    fn empty_inputs_give_empty_or_unchanged_order() {
        assert!(pin_recent_targets(&[], &[]).is_empty());
        let items = vec![key("section", "s1"), key("section", "s2")];
        assert_eq!(
            pin_recent_targets(&items, &[]),
            vec![
                PinnedSlot {
                    index: 0,
                    recent: false
                },
                PinnedSlot {
                    index: 1,
                    recent: false
                },
            ]
        );
    }
}
