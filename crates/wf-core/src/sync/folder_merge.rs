//! Settling a file both sides changed (TS `workspace/application/folder-merge.ts`): the merge
//! decision and the counts of an import preview. Pure; the file reads and writes stay in TS.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::sync::deserialize::{
    ImportDiffEntry, ImportMergeDetail, MergeFieldDispute, ParsedEntity,
};
use crate::sync::import_action::{ActionCounts, ConflictKind, ImportAction};
use crate::sync::merge::Conflict;
use crate::sync::merge_vault_page::{
    VaultPageBase, VaultPageMerge, merge_vault_page, vault_page_side,
};
use crate::sync::text_diff::{HunkPick, merge_hunks};

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

/// How the folder's copy is titled when both copies are kept (TS `keepBothTitle`).
#[must_use]
pub fn keep_both_title(title: &str) -> String {
    format!("{title} (from folder)")
}

/// A named choice for a both-changed file: the string forms of TS `ConflictResolution`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum NamedResolution {
    /// Leave the workspace's copy alone.
    Keep,
    /// Take the folder's copy over the workspace's.
    Folder,
    /// Import the folder's copy as a new note, leaving the workspace's untouched.
    Both,
    /// Write conflict markers into the folder's copy.
    Markers,
}

/// Which side a disputed key takes (TS `"ours" | "theirs"`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum FieldPick {
    /// The workspace's value.
    Ours,
    /// The folder's value.
    Theirs,
}

/// The only value [`ConflictPicks::kind`] takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum PicksKind {
    /// Picks per key and hunk.
    Picks,
}

/// A choice per disputed key, and per hunk of the body. Anything left out keeps ours,
/// the direction an unsettled difference always takes here.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ConflictPicks {
    /// Always `picks`; tells these apart from a [`NamedResolution`].
    pub kind: PicksKind,
    /// The side each disputed key takes, by key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<BTreeMap<String, FieldPick>>,
    /// The pick for each body hunk, by its decimal index.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hunks: Option<BTreeMap<String, HunkPick>>,
}

/// What to do about a file both sides changed: a named choice, or picks per key and hunk.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(untagged)]
pub enum ConflictResolution {
    /// One of the named choices.
    Named(NamedResolution),
    /// A choice per key and hunk.
    Picks(ConflictPicks),
}

/// Turn a settled conflict into an ordinary entry, or `None` to leave it alone (TS
/// `settleConflict`). A non-conflict entry comes back as it was.
#[must_use]
pub fn settle_conflict(
    entry: ImportDiffEntry,
    resolutions: &BTreeMap<String, ConflictResolution>,
) -> Option<ImportDiffEntry> {
    if entry.action != ImportAction::Conflict {
        return Some(entry);
    }
    // A file still holding markers is not importable at all.
    if entry.kind == Some(ConflictKind::Markers) {
        return None;
    }

    let asked = resolutions
        .get(&entry.entity.path)
        .cloned()
        .unwrap_or(ConflictResolution::Named(NamedResolution::Keep));
    match asked {
        ConflictResolution::Picks(picks) => settle_picks(entry, &picks),
        ConflictResolution::Named(NamedResolution::Markers) => None,
        ConflictResolution::Named(named) => {
            // A type mismatch has nothing to update: its id names a paper or an experiment,
            // so taking the folder's copy means importing it as a new note.
            let resolution = if named == NamedResolution::Folder
                && entry.kind == Some(ConflictKind::TypeMismatch)
            {
                NamedResolution::Both
            } else {
                named
            };
            match resolution {
                NamedResolution::Keep | NamedResolution::Markers => None,
                NamedResolution::Folder => Some(ImportDiffEntry {
                    action: ImportAction::Updated,
                    ..entry
                }),
                NamedResolution::Both => {
                    let entity = ParsedEntity {
                        id: None,
                        title: keep_both_title(&entry.entity.title),
                        ..entry.entity.clone()
                    };
                    Some(ImportDiffEntry {
                        action: ImportAction::Created,
                        entity,
                        ..entry
                    })
                }
            }
        }
    }
}

/// Compose a whole note from the choices, as an update (TS `settlePicks`). `None` when there
/// was no merge to choose from: a type mismatch, or a folder with no recorded base.
#[must_use]
pub fn settle_picks(entry: ImportDiffEntry, picks: &ConflictPicks) -> Option<ImportDiffEntry> {
    let detail = entry.merge.as_ref()?;

    let mut fields: Map<String, Value> = detail.fields.clone();
    for dispute in &detail.disputed {
        let pick = picks
            .fields
            .as_ref()
            .and_then(|by_key| by_key.get(&dispute.field))
            .copied()
            .unwrap_or(FieldPick::Ours);
        match pick {
            // A literal `null` ours is kept as `null`, as the TS sets it.
            FieldPick::Ours => {
                let _ = fields.insert(dispute.field.clone(), dispute.ours.clone());
            }
            // An absent theirs (JS `undefined`, read back as null) leaves the key out.
            FieldPick::Theirs if dispute.theirs.is_null() => {
                let _ = fields.remove(&dispute.field);
            }
            FieldPick::Theirs => {
                let _ = fields.insert(dispute.field.clone(), dispute.theirs.clone());
            }
        }
    }

    let title = match fields.remove("title") {
        Some(Value::String(title)) => title,
        _ => entry.entity.title.clone(),
    };
    let body = match &detail.body_sides {
        Some((ours, theirs)) => merge_hunks(ours, theirs, &hunk_picks(picks)),
        None => detail.body.clone(),
    };

    Some(ImportDiffEntry {
        action: ImportAction::Updated,
        kind: None,
        reason: None,
        conflict_fields: None,
        entity: ParsedEntity {
            title,
            fields,
            body,
            ..entry.entity.clone()
        },
        ..entry
    })
}

/// The hunk picks keyed by their index. Keys that are not canonical decimal indices are
/// dropped, as the wasm glue drops them for `mergeHunks`.
fn hunk_picks(picks: &ConflictPicks) -> BTreeMap<usize, HunkPick> {
    let Some(by_key) = &picks.hunks else {
        return BTreeMap::new();
    };
    by_key
        .iter()
        .filter_map(|(key, pick)| match key.parse::<usize>() {
            Ok(index) if index.to_string() == *key => Some((index, *pick)),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::change_origin::digest_text;
    use crate::sync::folder_layout::WorkspaceEntityType;
    use serde_json::json;

    /// The folder's copy of `notes/n1.note.md`, as the import reads it.
    fn both_changed(title: &str, body: &str, tags: Value) -> ImportDiffEntry {
        let mut fields = Map::new();
        let _ = fields.insert("tags".to_owned(), tags);
        ImportDiffEntry {
            action: ImportAction::Conflict,
            entity: ParsedEntity {
                id: Some("n1".to_owned()),
                entity_type: WorkspaceEntityType::VaultPage,
                title: title.to_owned(),
                body: body.to_owned(),
                path: "notes/n1.note.md".to_owned(),
                fields,
            },
            reason: None,
            kind: Some(ConflictKind::BothChanged),
            conflict_fields: None,
            merge: None,
        }
    }

    /// The fixture the TS parity test uses: the entry above, with a folder copy that is
    /// titled `Both of us edited this` and has body `the folder's copy`.
    fn settle_fixture(kind: ConflictKind) -> ImportDiffEntry {
        ImportDiffEntry {
            kind: Some(kind),
            ..both_changed("Both of us edited this", "the folder's copy", json!([]))
        }
    }

    fn resolve(path: &str, resolution: ConflictResolution) -> BTreeMap<String, ConflictResolution> {
        BTreeMap::from([(path.to_owned(), resolution)])
    }

    /// A base recorded when both sides last agreed: title `Shared note`, tags `a`, body `base`.
    fn base(body: &str) -> VaultPageBase {
        VaultPageBase {
            fields: json!({ "title": "Shared note", "tags": ["a"] }),
            body_digest: digest_text(body),
        }
    }

    fn note(fields: &str, body: &str, title: &str) -> String {
        format!(
            "---\nweaveforge-id: n1\nweaveforge-type: vault_page\ntitle: {title}\n{fields}---\n\n{body}\n"
        )
    }

    #[test]
    fn unsettled_conflict_stays_none() {
        let entry = settle_fixture(ConflictKind::BothChanged);
        assert_eq!(settle_conflict(entry.clone(), &BTreeMap::new()), None);
        assert_eq!(
            settle_conflict(
                entry.clone(),
                &resolve(
                    "notes/n1.note.md",
                    ConflictResolution::Named(NamedResolution::Keep)
                )
            ),
            None
        );
        // Somebody else's conflict being settled does not settle this one.
        assert_eq!(
            settle_conflict(
                entry,
                &resolve(
                    "notes/other.note.md",
                    ConflictResolution::Named(NamedResolution::Folder)
                )
            ),
            None
        );
    }

    #[test]
    fn taking_the_folder_copy_is_an_update_to_the_same_note() {
        let settled = settle_conflict(
            settle_fixture(ConflictKind::BothChanged),
            &resolve(
                "notes/n1.note.md",
                ConflictResolution::Named(NamedResolution::Folder),
            ),
        )
        .expect("settled");
        assert_eq!(settled.action, ImportAction::Updated);
        assert_eq!(settled.entity.id.as_deref(), Some("n1"));
        assert_eq!(settled.entity.title, "Both of us edited this");
    }

    #[test]
    fn keeping_both_creates_a_note_and_drops_the_id() {
        let settled = settle_conflict(
            settle_fixture(ConflictKind::BothChanged),
            &resolve(
                "notes/n1.note.md",
                ConflictResolution::Named(NamedResolution::Both),
            ),
        )
        .expect("settled");
        assert_eq!(settled.action, ImportAction::Created);
        assert_eq!(settled.entity.id, None);
        assert_eq!(
            settled.entity.title,
            keep_both_title("Both of us edited this")
        );
        assert_eq!(settled.entity.body, "the folder's copy");
    }

    #[test]
    fn folder_for_a_type_mismatch_is_imported_as_new() {
        // Parity point: a type mismatch cannot be overwritten, so Folder becomes Both.
        let settled = settle_conflict(
            settle_fixture(ConflictKind::TypeMismatch),
            &resolve(
                "notes/n1.note.md",
                ConflictResolution::Named(NamedResolution::Folder),
            ),
        )
        .expect("settled");
        assert_eq!(settled.action, ImportAction::Created);
        assert_eq!(settled.entity.id, None);
    }

    #[test]
    fn type_mismatch_left_alone_is_still_left_alone() {
        assert_eq!(
            settle_conflict(settle_fixture(ConflictKind::TypeMismatch), &BTreeMap::new()),
            None
        );
    }

    #[test]
    fn markers_kind_is_never_importable() {
        let resolutions = resolve(
            "notes/n1.note.md",
            ConflictResolution::Named(NamedResolution::Folder),
        );
        assert_eq!(
            settle_conflict(settle_fixture(ConflictKind::Markers), &resolutions),
            None
        );
    }

    #[test]
    fn asking_for_markers_settles_nothing() {
        let resolutions = resolve(
            "notes/n1.note.md",
            ConflictResolution::Named(NamedResolution::Markers),
        );
        assert_eq!(
            settle_conflict(settle_fixture(ConflictKind::BothChanged), &resolutions),
            None
        );
    }

    #[test]
    fn non_conflicts_pass_through_untouched() {
        let update = ImportDiffEntry {
            action: ImportAction::Updated,
            ..both_changed("Both of us edited this", "the folder's copy", json!([]))
        };
        let resolutions = resolve(
            "notes/n1.note.md",
            ConflictResolution::Named(NamedResolution::Both),
        );
        assert_eq!(settle_conflict(update.clone(), &resolutions), Some(update));
    }

    #[test]
    fn edits_that_do_not_collide_are_merged() {
        let entry = both_changed("Shared note", "the original body", json!(["a", "b"]));
        let merged = merge_both_changed(
            entry,
            Some(&base("the original body")),
            Some(
                note(
                    "tags:\n  - a\n",
                    "a body rewritten in the app",
                    "Shared note",
                )
                .as_str(),
            ),
        );
        assert_eq!(merged.action, ImportAction::Updated);
        assert_eq!(merged.kind, None);
        assert_eq!(merged.entity.body.trim(), "a body rewritten in the app");
        assert_eq!(merged.entity.fields.get("tags"), Some(&json!(["a", "b"])));
    }

    #[test]
    fn a_body_both_sides_rewrote_stays_a_conflict_and_says_so() {
        let entry = both_changed("Shared note", "the original body", json!(["a", "b"]));
        let merged = merge_both_changed(
            entry,
            Some(&base("something else entirely")),
            Some(
                note(
                    "tags:\n  - a\n  - b\n",
                    "a body rewritten in the app",
                    "Shared note",
                )
                .as_str(),
            ),
        );
        assert_eq!(merged.action, ImportAction::Conflict);
        assert_eq!(merged.conflict_fields, Some(vec!["body".to_owned()]));
        assert!(
            merged
                .reason
                .unwrap_or_default()
                .contains("both sides changed body")
        );
    }

    #[test]
    fn several_colliding_fields_are_all_named() {
        let entry = both_changed("Their title", "the original body", json!(["a", "b"]));
        let merged = merge_both_changed(
            entry,
            Some(&base("something else entirely")),
            Some(note("tags:\n  - a\n", "our rewrite", "Our title").as_str()),
        );
        assert_eq!(
            merged.conflict_fields,
            Some(vec!["title".to_owned(), "body".to_owned()])
        );
        assert!(merged.reason.unwrap_or_default().contains("title and body"));
    }

    #[test]
    fn no_base_or_no_workspace_content_returns_the_entry_unchanged() {
        // Parity point: a folder with no recorded base has no three sides, so the entry
        // stays as it was and the person decides.
        let entry = both_changed("Shared note", "the original body", json!(["a", "b"]));
        assert_eq!(
            merge_both_changed(
                entry.clone(),
                None,
                Some(note("", "x", "Shared note").as_str())
            ),
            entry
        );
        assert_eq!(
            merge_both_changed(entry.clone(), Some(&base("the original body")), None),
            entry
        );
    }

    #[test]
    fn a_type_mismatch_is_not_settled_by_a_field_merge() {
        let mismatch = ImportDiffEntry {
            kind: Some(ConflictKind::TypeMismatch),
            ..both_changed("Shared note", "the original body", json!(["a", "b"]))
        };
        assert_eq!(
            merge_both_changed(
                mismatch.clone(),
                Some(&base("the original body")),
                Some(note("", "x", "Shared note").as_str())
            ),
            mismatch
        );
    }

    #[test]
    fn picks_on_a_type_mismatch_have_no_merge_to_settle() {
        // Parity point: no merge means picks cannot be composed, so the answer is None.
        let mismatch = settle_fixture(ConflictKind::TypeMismatch);
        let picks = ConflictPicks {
            kind: PicksKind::Picks,
            fields: None,
            hunks: None,
        };
        assert_eq!(settle_picks(mismatch, &picks), None);
    }

    #[test]
    fn picks_choose_the_folder_side_of_a_disputed_title() {
        // Title in dispute: the workspace says `Our title`, the folder `Their title`.
        let entry = both_changed("Their title", "the original body", json!(["a", "b"]));
        let merged = merge_both_changed(
            entry,
            Some(&base("something else entirely")),
            Some(note("tags:\n  - a\n", "our rewrite", "Our title").as_str()),
        );
        let default_picks = ConflictPicks {
            kind: PicksKind::Picks,
            fields: None,
            hunks: None,
        };
        let ours = settle_picks(merged.clone(), &default_picks).expect("merge present");
        assert_eq!(ours.entity.title, "Our title");
        assert_eq!(ours.action, ImportAction::Updated);
        assert_eq!(ours.conflict_fields, None);

        let theirs_picks = ConflictPicks {
            kind: PicksKind::Picks,
            fields: Some(BTreeMap::from([("title".to_owned(), FieldPick::Theirs)])),
            hunks: None,
        };
        let theirs = settle_picks(merged, &theirs_picks).expect("merge present");
        assert_eq!(theirs.entity.title, "Their title");
        assert!(!theirs.entity.fields.contains_key("title"));
    }

    #[test]
    fn a_folder_side_that_is_absent_drops_the_key() {
        // Parity point: `theirs` absent (null) leaves the key out, as the TS sets undefined.
        let detail = ImportMergeDetail {
            fields: Map::from_iter([("tags".to_owned(), json!(["a"]))]),
            body: "b".to_owned(),
            disputed: vec![MergeFieldDispute {
                field: "tags".to_owned(),
                base: Value::Null,
                ours: json!(["a"]),
                theirs: Value::Null,
            }],
            body_sides: None,
        };
        let entry = ImportDiffEntry {
            merge: Some(detail),
            ..both_changed("Shared note", "b", json!([]))
        };
        let picks = ConflictPicks {
            kind: PicksKind::Picks,
            fields: Some(BTreeMap::from([("tags".to_owned(), FieldPick::Theirs)])),
            hunks: None,
        };
        let settled = settle_picks(entry, &picks).expect("merge present");
        assert!(!settled.entity.fields.contains_key("tags"));
    }

    #[test]
    fn a_literal_null_ours_is_kept_as_null() {
        // Parity point (a): ours `null` sets the key to null, as the TS does; it is not deleted.
        let detail = ImportMergeDetail {
            fields: Map::from_iter([("status".to_owned(), json!("open"))]),
            body: "b".to_owned(),
            disputed: vec![MergeFieldDispute {
                field: "status".to_owned(),
                base: json!("open"),
                ours: Value::Null,
                theirs: json!("closed"),
            }],
            body_sides: None,
        };
        let entry = ImportDiffEntry {
            merge: Some(detail),
            ..both_changed("Shared note", "b", json!([]))
        };
        let picks = ConflictPicks {
            kind: PicksKind::Picks,
            fields: Some(BTreeMap::from([("status".to_owned(), FieldPick::Ours)])),
            hunks: None,
        };
        let settled = settle_picks(entry, &picks).expect("merge present");
        assert_eq!(settled.entity.fields.get("status"), Some(&Value::Null));
    }

    #[test]
    fn hunk_picks_keep_only_canonical_indices() {
        let picks = ConflictPicks {
            kind: PicksKind::Picks,
            fields: None,
            hunks: Some(BTreeMap::from([
                ("1".to_owned(), HunkPick::Theirs),
                ("01".to_owned(), HunkPick::Theirs),
                ("x".to_owned(), HunkPick::Theirs),
            ])),
        };
        assert_eq!(hunk_picks(&picks), BTreeMap::from([(1, HunkPick::Theirs)]));
    }

    #[test]
    fn keep_both_title_suffixes_the_folder_marker() {
        assert_eq!(keep_both_title("Notes"), "Notes (from folder)");
    }

    #[test]
    fn resolution_wire_forms_are_a_name_or_picks_object() {
        let named: ConflictResolution = serde_json::from_value(json!("folder")).expect("named");
        assert_eq!(named, ConflictResolution::Named(NamedResolution::Folder));
        let picks: ConflictResolution =
            serde_json::from_value(json!({ "kind": "picks", "fields": { "title": "theirs" } }))
                .expect("picks");
        assert!(matches!(picks, ConflictResolution::Picks(_)));
    }

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
