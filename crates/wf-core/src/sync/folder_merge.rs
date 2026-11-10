//! Settling a file both sides changed (TS `workspace/application/folder-merge.ts`): the merge
//! decision and the counts of an import preview. Pure; the file reads and writes stay in TS.

use serde_json::Value;

use crate::sync::deserialize::{ImportDiffEntry, ImportMergeDetail, MergeFieldDispute};
use crate::sync::import_action::{ActionCounts, ConflictKind, ImportAction};
use crate::sync::merge::Conflict;
use crate::sync::merge_vault_page::{
    VaultPageBase, VaultPageMerge, merge_vault_page, vault_page_side,
};

/// Settle a both-changed file per field, or say what is actually in dispute.
///
/// The folder's side is taken from the entry, not re-read from the file. Anything the merge
/// cannot settle stays a conflict. A missing base, or missing workspace content, keeps the
/// entry as it was.
#[must_use]
pub fn merge_both_changed(
    entry: ImportDiffEntry,
    base: Option<&VaultPageBase>,
    workspace_content: Option<&str>,
) -> ImportDiffEntry {
    if entry.action != ImportAction::Conflict || entry.kind != Some(ConflictKind::BothChanged) {
        return entry;
    }
    let (Some(base), Some(workspace_content)) = (base, workspace_content) else {
        return entry;
    };
    let Some(workspace) = vault_page_side(&entry.entity.path, workspace_content) else {
        return entry;
    };
    let mut folder_fields = entry.entity.fields.clone();
    let _ = folder_fields.insert(
        "title".to_owned(),
        Value::String(entry.entity.title.clone()),
    );
    let folder = crate::sync::merge_vault_page::VaultPageSide {
        fields: folder_fields,
        body: entry.entity.body.clone(),
    };
    let merged = merge_vault_page(base, &folder, &workspace);

    if !merged.conflicts.is_empty() {
        let fields: Vec<String> = merged.conflicts.iter().map(|c| c.field.clone()).collect();
        let reason = format!(
            "{}: both sides changed {}.",
            entry.entity.path,
            list_fields(&fields)
        );
        let merge = merge_detail(&merged, &entry, &workspace.body);
        return ImportDiffEntry {
            conflict_fields: Some(fields),
            merge: Some(merge),
            reason: Some(reason),
            ..entry
        };
    }

    let mut fields = merged.fields;
    let title = match fields.remove("title") {
        Some(Value::String(title)) => title,
        _ => entry.entity.title.clone(),
    };
    let mut entity = entry.entity;
    entity.title = title;
    entity.fields = fields;
    entity.body = merged.body;
    ImportDiffEntry {
        action: ImportAction::Updated,
        kind: None,
        reason: None,
        entity,
        conflict_fields: entry.conflict_fields,
        merge: entry.merge,
    }
}

/// What the resolver may choose between: the merged fields and body, the keys and body
/// that are in dispute, and both body copies when the body itself is in dispute.
fn merge_detail(
    merged: &VaultPageMerge,
    entry: &ImportDiffEntry,
    workspace_body: &str,
) -> ImportMergeDetail {
    let disputed: Vec<MergeFieldDispute> = merged
        .conflicts
        .iter()
        .filter(|c| c.field != "body")
        .map(dispute)
        .collect();
    let body_disputed = merged.conflicts.iter().any(|c| c.field == "body");
    ImportMergeDetail {
        fields: merged.fields.clone(),
        body: merged.body.clone(),
        disputed,
        body_sides: body_disputed.then(|| (workspace_body.to_owned(), entry.entity.body.clone())),
    }
}

/// One disputed key, with the workspace's value as `ours` and the folder's as `theirs`.
fn dispute(conflict: &Conflict) -> MergeFieldDispute {
    MergeFieldDispute {
        field: conflict.field.clone(),
        base: conflict.base.clone(),
        ours: conflict.remote.clone(),
        theirs: conflict.local.clone(),
    }
}

/// `a`, `a and b`, or `a, b and c`.
fn list_fields(fields: &[String]) -> String {
    match fields {
        [] => String::new(),
        [only] => only.clone(),
        [init @ .., last] => format!("{} and {last}", init.join(", ")),
    }
}

/// How many entries carry each action (TS `countActions`).
#[must_use]
pub fn count_actions(entries: &[ImportDiffEntry]) -> ActionCounts {
    let actions: Vec<ImportAction> = entries.iter().map(|entry| entry.action).collect();
    count_action_list(&actions)
}

/// How many of `actions` are each action: the same tally as [`count_actions`], for
/// callers that hold only the actions.
#[must_use]
pub fn count_action_list(actions: &[ImportAction]) -> ActionCounts {
    let mut counts = ActionCounts::default();
    for action in actions {
        counts.add(*action, 1);
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_fields_as_english() {
        assert_eq!(list_fields(&["a".to_owned()]), "a");
        assert_eq!(list_fields(&["a".to_owned(), "b".to_owned()]), "a and b");
        assert_eq!(
            list_fields(&["a".to_owned(), "b".to_owned(), "c".to_owned()]),
            "a, b and c"
        );
    }

    #[test]
    fn counts_each_action() {
        let counts = count_actions(&[]);
        assert_eq!(counts, ActionCounts::default());
    }

    #[test]
    fn count_action_list_tallies_each_action() {
        let actions = [
            ImportAction::Created,
            ImportAction::Created,
            ImportAction::Removed,
        ];
        let counts = count_action_list(&actions);
        assert_eq!(counts.created, 2);
        assert_eq!(counts.removed, 1);
        assert_eq!(counts.updated, 0);
        assert_eq!(count_action_list(&[]), ActionCounts::default());
    }
}
