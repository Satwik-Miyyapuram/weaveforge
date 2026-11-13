//! `⌘D`: a copy of the note on screen, beside it, titled "X (copy)". Ported
//! from `apps/web/src/features/editor-workspace/application/duplicate-note.ts`.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::vault::page::normalize_title_key;

/// A document as the duplicate plan reads it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DuplicateSource {
    /// The entity kind, as the workspace names it (`vault_page`, `ink_page`, ...).
    pub kind: String,
    /// The document's title.
    pub title: String,
    /// The full body. A preview body fails the plan through `hydrated`.
    pub body: String,
    /// False while the body is still the 320-character preview.
    pub hydrated: bool,
    /// The folder the document sits in, when it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub parent_id: Option<String>,
}

/// What to create for a duplicate.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DuplicatePlan {
    /// The first free "X (copy)" title.
    pub title: String,
    /// The source's folder, so the copy lands beside it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub parent_id: Option<String>,
    /// The source's body, unchanged.
    pub body: String,
}

fn is_note(kind: &str) -> bool {
    matches!(kind, "vault_page" | "ink_page")
}

/// What to create, or `None` when the document is not a note or its body is
/// still the preview (copying that would cut the note at 320 characters).
///
/// Note titles are unique across the vault, so the copy takes the first free
/// "(copy)" or "(copy n)" title, compared with the same key the wikilinks use.
#[must_use]
pub fn duplicate_plan(
    doc: Option<&DuplicateSource>,
    documents: &[DuplicateSource],
) -> Option<DuplicatePlan> {
    let doc = doc?;
    if !is_note(&doc.kind) || !doc.hydrated {
        return None;
    }
    let taken: HashSet<String> = documents
        .iter()
        .filter(|d| is_note(&d.kind))
        .map(|d| normalize_title_key(&d.title))
        .collect();
    let mut title = format!("{} (copy)", doc.title);
    let mut n = 2_usize;
    while taken.contains(&normalize_title_key(&title)) {
        title = format!("{} (copy {n})", doc.title);
        n += 1;
    }
    Some(DuplicatePlan {
        title,
        parent_id: doc.parent_id.clone(),
        body: doc.body.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(title: &str) -> DuplicateSource {
        DuplicateSource {
            kind: "vault_page".to_owned(),
            title: title.to_owned(),
            body: "text".to_owned(),
            hydrated: true,
            parent_id: None,
        }
    }

    #[test]
    fn first_copy_title() {
        let source = note("Sampling");
        let plan = duplicate_plan(Some(&source), std::slice::from_ref(&source)).expect("plan");
        assert_eq!(plan.title, "Sampling (copy)");
        assert_eq!(plan.body, "text");
        assert_eq!(plan.parent_id, None);
    }

    #[test]
    fn takes_first_free_number() {
        let source = note("Sampling");
        let taken = vec![
            note("Sampling"),
            note("Sampling (copy)"),
            note("Sampling (copy 2)"),
        ];
        let plan = duplicate_plan(Some(&source), &taken).expect("plan");
        assert_eq!(plan.title, "Sampling (copy 3)");
    }

    #[test]
    fn taken_check_ignores_case_and_spacing() {
        let source = note("Sampling");
        let taken = vec![note("sampling  (COPY)")];
        let plan = duplicate_plan(Some(&source), &taken).expect("plan");
        assert_eq!(plan.title, "Sampling (copy 2)");
    }

    #[test]
    fn only_notes_copy_and_only_hydrated_bodies() {
        let source = note("Sampling");
        let mut paper = note("Sampling");
        paper.kind = "paper".to_owned();
        assert_eq!(duplicate_plan(Some(&paper), &[]), None);
        let mut preview = note("Sampling");
        preview.hydrated = false;
        assert_eq!(duplicate_plan(Some(&preview), &[]), None);
        assert_eq!(duplicate_plan(None, std::slice::from_ref(&source)), None);
    }
}
