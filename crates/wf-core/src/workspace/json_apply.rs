//! Which stored rows a folder's JSON import writes, and in what order (`applyJsonEntries` in
//! `apps/web/src/features/workspace/application/parts-1.ts`).
//!
//! Each entry is routed to the feature that owns its rows. A conflict is the reader's to settle
//! and an unchanged row needs nothing, so both are skipped. The saves and deletes themselves stay
//! in TypeScript, which holds the repositories; this only decides the calls.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::sync::import_action::ImportAction;

/// The feature a JSON data file's rows belong to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JsonTarget {
    /// `relations.json`: paper-to-paper edges.
    Relations,
    /// `tags.json`.
    Tags,
    /// `reading-list-items.json`, and any kind this plan does not name.
    ReadingListItems,
}

/// One JSON diff entry, as the preview produced it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonEntry {
    /// What the import would do with the row.
    pub action: ImportAction,
    /// The data file kind: `relations`, `tags` or `reading_list_items`.
    pub kind: String,
    /// The data file the row came from.
    pub path: String,
    /// Id of the stored row the entry is about (the one a removal deletes).
    pub existing_id: String,
}

/// One call to make: save the entry's row, or remove the stored row named by `id`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonStep {
    /// Index of the entry in the input, so the caller can read its row.
    pub index: usize,
    /// Which feature's repository receives the call.
    pub target: JsonTarget,
    /// True to remove `id`; false to save the entry's row.
    pub remove: bool,
    /// The stored row's id (the one a removal deletes).
    pub id: String,
}

/// The ordered calls for an import, and the data files whose rows were applied.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonApplyPlan {
    /// Calls in entry order.
    pub steps: Vec<JsonStep>,
    /// Distinct data file paths, in first-applied order.
    pub files: Vec<String>,
}

fn target_for(kind: &str) -> JsonTarget {
    match kind {
        "relations" => JsonTarget::Relations,
        "tags" => JsonTarget::Tags,
        _ => JsonTarget::ReadingListItems,
    }
}

/// Plan the writes for a folder's JSON entries: skip unchanged and conflicting rows, remove the
/// removed ones, save the rest, and route each to its feature.
#[must_use]
pub fn plan_json_apply(entries: &[JsonEntry]) -> JsonApplyPlan {
    let mut steps = Vec::new();
    let mut files = Vec::new();
    let mut seen_files = HashSet::new();
    for (index, entry) in entries.iter().enumerate() {
        if matches!(entry.action, ImportAction::Unchanged | ImportAction::Conflict) {
            continue;
        }
        steps.push(JsonStep {
            index,
            target: target_for(&entry.kind),
            remove: entry.action == ImportAction::Removed,
            id: entry.existing_id.clone(),
        });
        if seen_files.insert(entry.path.as_str()) {
            files.push(entry.path.clone());
        }
    }
    JsonApplyPlan { steps, files }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(action: ImportAction, kind: &str, path: &str, existing_id: &str) -> JsonEntry {
        JsonEntry {
            action,
            kind: kind.to_owned(),
            path: path.to_owned(),
            existing_id: existing_id.to_owned(),
        }
    }

    // Rust-only: unchanged rows and conflicts are never written.
    #[test]
    fn skips_unchanged_and_conflicting_rows() {
        let entries = [
            entry(ImportAction::Unchanged, "tags", ".weaveforge/tags.json", "t1"),
            entry(ImportAction::Conflict, "relations", ".weaveforge/relations.json", "r1"),
        ];
        let plan = plan_json_apply(&entries);
        assert!(plan.steps.is_empty());
        assert!(plan.files.is_empty());
    }

    // Rust-only: a removed row deletes its stored id; a created or updated row is saved.
    #[test]
    fn removed_rows_delete_and_others_save() {
        let entries = [
            entry(ImportAction::Removed, "tags", "p/tags.json", "t1"),
            entry(ImportAction::Created, "tags", "p/tags.json", "t2"),
            entry(ImportAction::Updated, "tags", "p/tags.json", "t3"),
        ];
        let plan = plan_json_apply(&entries);
        let shape: Vec<(usize, bool, &str)> = plan
            .steps
            .iter()
            .map(|step| (step.index, step.remove, step.id.as_str()))
            .collect();
        assert_eq!(shape, vec![(0, true, "t1"), (1, false, "t2"), (2, false, "t3")]);
    }

    // Rust-only: each kind goes to its feature; an unknown kind falls to reading list items.
    #[test]
    fn routes_each_kind_to_its_feature() {
        let entries = [
            entry(ImportAction::Created, "relations", "p/r.json", "r"),
            entry(ImportAction::Created, "tags", "p/t.json", "t"),
            entry(ImportAction::Created, "reading_list_items", "p/l.json", "l"),
            entry(ImportAction::Created, "something_else", "p/x.json", "x"),
        ];
        let targets: Vec<JsonTarget> = plan_json_apply(&entries)
            .steps
            .iter()
            .map(|step| step.target)
            .collect();
        assert_eq!(
            targets,
            vec![
                JsonTarget::Relations,
                JsonTarget::Tags,
                JsonTarget::ReadingListItems,
                JsonTarget::ReadingListItems,
            ]
        );
    }

    // Rust-only: applied files are listed once each, in first-applied order.
    #[test]
    fn files_are_distinct_in_first_applied_order() {
        let entries = [
            entry(ImportAction::Created, "tags", "b.json", "1"),
            entry(ImportAction::Unchanged, "tags", "skipped.json", "2"),
            entry(ImportAction::Updated, "tags", "a.json", "3"),
            entry(ImportAction::Removed, "tags", "b.json", "4"),
        ];
        let plan = plan_json_apply(&entries);
        assert_eq!(plan.files, vec!["b.json".to_owned(), "a.json".to_owned()]);
    }
}
