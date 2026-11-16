//! Settling the outside-edit list after a preview (`settleExternalChanges` in
//! `apps/web/.../workspace/application/workspace-folder.ts`).
//!
//! After a preview, the list keeps only what the preview found changed. A preview
//! of some paths (`only`) settles just those; the rest of the list stays as it was,
//! with its reasons. The caller gathers the preview's entries and the held reasons;
//! this decides what the list and its reasons become.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use super::outside_edits::HeldReason;
use crate::sync::import_action::ImportAction;

/// One note or JSON row entry of a preview, by path.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleEntry {
    /// What the preview found for the path.
    pub action: ImportAction,
    /// Path.
    pub path: String,
}

/// The settle input: the preview's entries, its held reasons, and the list as it stands.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleInput {
    /// Note and row entries of the preview.
    #[serde(default)]
    pub entries: Vec<SettleEntry>,
    /// Why each held path waits, from the outside-edit split of the preview.
    #[serde(default)]
    pub reasons: BTreeMap<String, HeldReason>,
    /// The paths the preview covered; `None` means the whole folder.
    #[serde(default)]
    pub only: Option<Vec<String>>,
    /// The list as it stands.
    #[serde(default)]
    pub external: Vec<String>,
    /// Why each listed path waits, as it stands.
    #[serde(default)]
    pub external_reasons: BTreeMap<String, HeldReason>,
}

/// The settled list and its reasons.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettleVerdict {
    /// Paths still listed, sorted.
    pub external: Vec<String>,
    /// Why each listed path waits.
    pub external_reasons: BTreeMap<String, HeldReason>,
}

/// Decide the outside-edit list after a preview.
///
/// Without `only` the list becomes exactly what the preview found changed. With
/// `only`, the paths it covered are settled from the preview and every other listed
/// path stays listed with its old reason.
#[must_use]
pub fn settle_external(input: &SettleInput) -> SettleVerdict {
    let mut changed: BTreeSet<String> = input
        .entries
        .iter()
        .filter(|entry| entry.action != ImportAction::Unchanged)
        .map(|entry| entry.path.clone())
        .collect();

    let Some(only) = &input.only else {
        return SettleVerdict {
            external: changed.into_iter().collect(),
            external_reasons: input.reasons.clone(),
        };
    };
    let covered: BTreeSet<&str> = only.iter().map(String::as_str).collect();

    for path in &input.external {
        if !covered.contains(path.as_str()) {
            let _ = changed.insert(path.clone());
        }
    }
    let mut external_reasons: BTreeMap<String, HeldReason> = input
        .external_reasons
        .iter()
        .filter(|(path, _)| !covered.contains(path.as_str()))
        .map(|(path, reason)| (path.clone(), *reason))
        .collect();
    external_reasons.extend(
        input
            .reasons
            .iter()
            .map(|(path, reason)| (path.clone(), *reason)),
    );

    SettleVerdict {
        external: changed.into_iter().collect(),
        external_reasons,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(action: ImportAction, path: &str) -> SettleEntry {
        SettleEntry {
            action,
            path: path.to_owned(),
        }
    }

    // it: "after a preview the outside list is what the preview found changed, no more"
    #[test]
    fn after_a_preview_the_outside_list_is_what_the_preview_found_changed_no_more() {
        let input = SettleInput {
            entries: vec![
                entry(ImportAction::Unchanged, "notes/one.note.md"),
                entry(ImportAction::Updated, "notes/two.note.md"),
                entry(ImportAction::Removed, "data/tags.json"),
                entry(ImportAction::Unchanged, "data/lists.json"),
            ],
            external: vec![
                "notes/one.note.md".to_owned(),
                "notes/two.note.md".to_owned(),
            ],
            ..SettleInput::default()
        };
        let verdict = settle_external(&input);
        assert_eq!(
            verdict.external,
            vec!["data/tags.json", "notes/two.note.md"]
        );
    }

    // it: "a preview of some paths settles those and leaves the rest of the list"
    #[test]
    fn a_preview_of_some_paths_settles_those_and_leaves_the_rest_of_the_list() {
        let mut reasons = BTreeMap::new();
        let _ = reasons.insert("notes/gone.note.md".to_owned(), HeldReason::Removed);
        let _ = reasons.insert("notes/also.note.md".to_owned(), HeldReason::Removed);
        let first = settle_external(&SettleInput {
            entries: vec![
                entry(ImportAction::Removed, "notes/gone.note.md"),
                entry(ImportAction::Removed, "notes/also.note.md"),
            ],
            reasons,
            ..SettleInput::default()
        });
        let only = vec!["notes/also.note.md".to_owned()];
        let second = settle_external(&SettleInput {
            entries: vec![entry(ImportAction::Unchanged, "notes/also.note.md")],
            reasons: BTreeMap::new(),
            only: Some(only),
            external: first.external.clone(),
            external_reasons: first.external_reasons.clone(),
        });
        assert_eq!(second.external, vec!["notes/gone.note.md"]);
        assert_eq!(
            second.external_reasons.get("notes/gone.note.md"),
            Some(&HeldReason::Removed)
        );
        assert_eq!(second.external_reasons.get("notes/also.note.md"), None);
    }

    #[test]
    fn a_covered_path_takes_the_preview_reason_and_an_uncovered_one_keeps_its_own() {
        let mut reasons = BTreeMap::new();
        let _ = reasons.insert("a.md".to_owned(), HeldReason::EditedOnBothSides);
        let mut old_reasons = BTreeMap::new();
        let _ = old_reasons.insert("a.md".to_owned(), HeldReason::Removed);
        let _ = old_reasons.insert("b.md".to_owned(), HeldReason::OpenInEditor);
        let verdict = settle_external(&SettleInput {
            entries: vec![entry(ImportAction::Updated, "a.md")],
            reasons,
            only: Some(vec!["a.md".to_owned()]),
            external: vec!["a.md".to_owned(), "b.md".to_owned()],
            external_reasons: old_reasons,
        });
        assert_eq!(verdict.external, vec!["a.md", "b.md"]);
        assert_eq!(
            verdict.external_reasons.get("a.md"),
            Some(&HeldReason::EditedOnBothSides)
        );
        assert_eq!(
            verdict.external_reasons.get("b.md"),
            Some(&HeldReason::OpenInEditor)
        );
    }
}
