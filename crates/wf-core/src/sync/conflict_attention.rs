//! Ports `countOpenConflicts` in `apps/web/src/features/offline-sync/ui/sync-loop.tsx`
//! and `keepAllConflicts` in `ui/use-sync-issues.ts` (the edit branch). The
//! delete branch already routes through `conflict_deletion::deletion_for`.

use serde::{Deserialize, Serialize};

use super::conflict_deletion::PickSide;

/// An open conflict as the panel counts it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OpenConflict {
    /// `"edit"`, `"deleted_remote"` or `"deleted_local"`.
    pub kind: String,
    /// How many fields are in dispute. Only an edit conflict can have none.
    pub field_count: usize,
}

/// A field a bulk pick settles, and the side it takes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FieldPick {
    /// The field name, as the conflict lists it.
    pub field: String,
    /// The side the pick favours.
    pub side: PickSide,
}

/// Whether an open conflict still needs a person: every delete does, and an
/// edit does only when it has fields in dispute. An edit with none settles itself.
#[must_use]
pub fn needs_person(kind: &str, field_count: usize) -> bool {
    kind != "edit" || field_count > 0
}

/// How many open conflicts still need a person.
#[must_use]
pub fn count_open(open: &[OpenConflict]) -> usize {
    open.iter()
        .filter(|c| needs_person(&c.kind, c.field_count))
        .count()
}

/// The picks a "keep all" on an edit conflict makes: one per field, all on `side`.
/// An edit with no fields makes none.
#[must_use]
pub fn keep_all_picks(fields: &[String], side: PickSide) -> Vec<FieldPick> {
    fields
        .iter()
        .map(|field| FieldPick {
            field: field.clone(),
            side,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{FieldPick, OpenConflict, count_open, keep_all_picks, needs_person};
    use crate::sync::conflict_deletion::PickSide;

    fn open(kind: &str, field_count: usize) -> OpenConflict {
        OpenConflict {
            kind: kind.to_owned(),
            field_count,
        }
    }

    #[test]
    fn deletes_always_need_a_person() {
        assert!(needs_person("deleted_remote", 0));
        assert!(needs_person("deleted_local", 0));
    }

    #[test]
    fn edit_needs_a_person_only_with_fields() {
        assert!(needs_person("edit", 2));
        assert!(!needs_person("edit", 0));
    }

    #[test]
    fn counts_only_conflicts_needing_a_person() {
        let items = [open("edit", 0), open("edit", 1), open("deleted_local", 0)];
        assert_eq!(count_open(&items), 2);
        assert_eq!(count_open(&[]), 0);
    }

    #[test]
    fn keep_all_picks_every_field_on_the_side() {
        let fields = ["title".to_owned(), "body".to_owned()];
        assert_eq!(
            keep_all_picks(&fields, PickSide::Remote),
            vec![
                FieldPick {
                    field: "title".to_owned(),
                    side: PickSide::Remote
                },
                FieldPick {
                    field: "body".to_owned(),
                    side: PickSide::Remote
                },
            ]
        );
        assert!(keep_all_picks(&[], PickSide::Local).is_empty());
    }
}
