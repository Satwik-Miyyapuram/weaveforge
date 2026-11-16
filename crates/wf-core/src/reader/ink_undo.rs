//! Undo and redo over pen strokes on a PDF. A faithful port of packages/core/src/reader/ink-undo.ts.
//!
//! Stays in TS: the hook that drives the stack and the sink calls that apply each step. The
//! TS `ReaderAnnotation` is mirrored by `ZoteroAnnotationLocal`, the same local row shape.

use serde::{Deserialize, Serialize};

use super::anchor::AnchorCombinedPdf;
use super::zotero_sync::ZoteroAnnotationLocal;

/// TS `ReaderAnnotation`.
type Annotation = ZoteroAnnotationLocal;

/// The fields an edit can change (TS `InkUndoPatch`). `None` means the field is not part of the edit.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct InkUndoPatch {
    /// New colour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub color: Option<String>,
    /// New researcher comment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub comment: Option<String>,
    /// New tags.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub tags: Option<Vec<String>>,
    /// New selected text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub text: Option<String>,
}

/// One undoable step (TS `InkUndoEntry`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum InkUndoEntry {
    /// A stroke was created; undo removes it, redo creates it again.
    Create {
        /// The created mark.
        annotation: Annotation,
    },
    /// A stroke was erased; undo creates it again, redo removes it.
    Remove {
        /// The erased mark.
        annotation: Annotation,
    },
    /// Several marks were deleted together; undo recreates all, redo removes all.
    RemoveMany {
        /// The deleted marks.
        annotations: Vec<Annotation>,
    },
    /// A mark's paths were rewritten (a stroke joined it, or it was moved).
    Anchor {
        /// The mark's id.
        id: String,
        /// Anchor before the rewrite.
        before: AnchorCombinedPdf,
        /// Anchor after the rewrite.
        after: AnchorCombinedPdf,
    },
    /// A mark's colour, comment, tags or text changed; each side holds the fields it set.
    Update {
        /// The mark's id.
        id: String,
        /// Fields before the edit.
        before: InkUndoPatch,
        /// Fields after the edit.
        after: InkUndoPatch,
    },
}

/// The undo and redo stacks (TS `InkUndoState`). The last element is the next step.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct InkUndoState {
    /// Steps that can be undone.
    pub undo: Vec<InkUndoEntry>,
    /// Steps that can be redone.
    pub redo: Vec<InkUndoEntry>,
}

/// A step taken off a stack, with the stacks after taking it (TS `{ state, entry }`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct InkUndoStep {
    /// The stacks after the step moved.
    pub state: InkUndoState,
    /// The step that moved.
    pub entry: InkUndoEntry,
}

/// Nothing recorded yet (TS `EMPTY_INK_UNDO`).
pub const EMPTY_INK_UNDO: InkUndoState = InkUndoState {
    undo: Vec::new(),
    redo: Vec::new(),
};

/// How many steps are kept (TS `INK_UNDO_LIMIT`). A page of handwriting is a few hundred strokes.
pub const INK_UNDO_LIMIT: usize = 200;

/// Record a step. A new step is a new branch: whatever was redoable is gone.
#[must_use]
pub fn push_ink_undo(state: &InkUndoState, entry: InkUndoEntry) -> InkUndoState {
    let mut undo = state.undo.clone();
    undo.push(entry);
    if undo.len() > INK_UNDO_LIMIT {
        // Keep the newest steps, dropping the oldest.
        undo = undo.split_off(undo.len() - INK_UNDO_LIMIT);
    }
    InkUndoState {
        undo,
        redo: Vec::new(),
    }
}

/// The step to undo, moved onto the redo stack; `None` when there is none.
#[must_use]
pub fn take_ink_undo(state: &InkUndoState) -> Option<InkUndoStep> {
    let (entry, rest) = state.undo.split_last()?;
    let mut redo = state.redo.clone();
    redo.push(entry.clone());
    Some(InkUndoStep {
        state: InkUndoState {
            undo: rest.to_vec(),
            redo,
        },
        entry: entry.clone(),
    })
}

/// The step to redo, moved back onto the undo stack; `None` when there is none.
#[must_use]
pub fn take_ink_redo(state: &InkUndoState) -> Option<InkUndoStep> {
    let (entry, rest) = state.redo.split_last()?;
    let mut undo = state.undo.clone();
    undo.push(entry.clone());
    Some(InkUndoStep {
        state: InkUndoState {
            undo,
            redo: rest.to_vec(),
        },
        entry: entry.clone(),
    })
}

/// A row was recreated under a new id: point every step at the new one.
///
/// Both stacks are rewritten, because an entry on either side may still name the row.
#[must_use]
pub fn rename_ink_undo_id(state: &InkUndoState, from: &str, to: &str) -> InkUndoState {
    if from == to {
        return state.clone();
    }
    InkUndoState {
        undo: state
            .undo
            .iter()
            .map(|entry| rename_entry(entry, from, to))
            .collect(),
        redo: state
            .redo
            .iter()
            .map(|entry| rename_entry(entry, from, to))
            .collect(),
    }
}

/// A row was rewritten outside the stack (a stroke joined it): keep the snapshot every entry
/// holds current, so recreating it brings back the whole mark.
#[must_use]
pub fn refresh_ink_undo_annotation(state: &InkUndoState, annotation: &Annotation) -> InkUndoState {
    InkUndoState {
        undo: state
            .undo
            .iter()
            .map(|entry| refresh_entry(entry, annotation))
            .collect(),
        redo: state
            .redo
            .iter()
            .map(|entry| refresh_entry(entry, annotation))
            .collect(),
    }
}

/// One entry with every reference to row `from` pointed at `to`.
fn rename_entry(entry: &InkUndoEntry, from: &str, to: &str) -> InkUndoEntry {
    let mut next = entry.clone();
    match &mut next {
        InkUndoEntry::Anchor { id, .. } | InkUndoEntry::Update { id, .. } => {
            if id.as_str() == from {
                *id = to.to_owned();
            }
        }
        InkUndoEntry::RemoveMany { annotations } => {
            for mark in annotations.iter_mut().filter(|mark| mark.id == from) {
                mark.id = to.to_owned();
            }
        }
        InkUndoEntry::Create { annotation } | InkUndoEntry::Remove { annotation } => {
            if annotation.id == from {
                annotation.id = to.to_owned();
            }
        }
    }
    next
}

/// One entry with its held snapshot of row `annotation.id` replaced by `annotation`.
fn refresh_entry(entry: &InkUndoEntry, annotation: &Annotation) -> InkUndoEntry {
    match entry {
        InkUndoEntry::Anchor { .. } | InkUndoEntry::Update { .. } => entry.clone(),
        InkUndoEntry::RemoveMany { annotations } => InkUndoEntry::RemoveMany {
            annotations: annotations
                .iter()
                .map(|held| refreshed(held, annotation))
                .collect(),
        },
        InkUndoEntry::Create { annotation: held } => InkUndoEntry::Create {
            annotation: refreshed(held, annotation),
        },
        InkUndoEntry::Remove { annotation: held } => InkUndoEntry::Remove {
            annotation: refreshed(held, annotation),
        },
    }
}

/// `fresh` when it is the same row as `held`, else `held`.
fn refreshed(held: &Annotation, fresh: &Annotation) -> Annotation {
    if held.id == fresh.id {
        fresh.clone()
    } else {
        held.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader::zotero_sync::{ZoteroAnnotationOrigin, ZoteroAnnotationType};

    fn mark(id: &str) -> Annotation {
        ZoteroAnnotationLocal {
            id: id.to_owned(),
            origin: ZoteroAnnotationOrigin::Local,
            zotero_key: None,
            kind: ZoteroAnnotationType::Ink,
            color: "#000000".to_owned(),
            text: String::new(),
            comment: String::new(),
            tags: Vec::new(),
            anchor: AnchorCombinedPdf::default(),
            sort_index: String::new(),
            created_at: "2024-01-01T00:00:00Z".to_owned(),
            updated_at: "2024-01-01T00:00:00Z".to_owned(),
            sync_state: None,
            zotero_version: None,
        }
    }

    fn create(id: &str) -> InkUndoEntry {
        InkUndoEntry::Create {
            annotation: mark(id),
        }
    }

    #[test]
    fn push_clears_redo_and_undo_redo_round_trip() {
        let s = push_ink_undo(&EMPTY_INK_UNDO, create("a"));
        let undone = take_ink_undo(&s).expect("undo step");
        assert_eq!(undone.entry, create("a"));
        assert!(undone.state.undo.is_empty());
        let redone = take_ink_redo(&undone.state).expect("redo step");
        assert_eq!(redone.state, s);
        let branched = push_ink_undo(&undone.state, create("b"));
        assert!(branched.redo.is_empty());
        assert!(take_ink_undo(&EMPTY_INK_UNDO).is_none());
        assert!(take_ink_redo(&EMPTY_INK_UNDO).is_none());
    }

    #[test]
    fn push_keeps_newest_limit_steps() {
        let mut s = EMPTY_INK_UNDO;
        for i in 0..=INK_UNDO_LIMIT {
            s = push_ink_undo(&s, create(&i.to_string()));
        }
        assert_eq!(s.undo.len(), INK_UNDO_LIMIT);
        assert_eq!(s.undo.first(), Some(&create("1")));
    }

    #[test]
    fn rename_rewrites_both_stacks_and_remove_many() {
        let many = InkUndoEntry::RemoveMany {
            annotations: vec![mark("old"), mark("keep")],
        };
        let s = InkUndoState {
            undo: vec![create("old"), many],
            redo: vec![create("old")],
        };
        let renamed = rename_ink_undo_id(&s, "old", "new");
        assert_eq!(renamed.undo[0], create("new"));
        assert_eq!(
            renamed.undo[1],
            InkUndoEntry::RemoveMany {
                annotations: vec![mark("new"), mark("keep")],
            }
        );
        assert_eq!(renamed.redo[0], create("new"));
    }

    #[test]
    fn refresh_replaces_snapshots_but_not_anchor_or_update_entries() {
        let mut fresh = mark("a");
        fresh.comment = "joined".to_owned();
        let anchor = InkUndoEntry::Anchor {
            id: "a".to_owned(),
            before: AnchorCombinedPdf::default(),
            after: AnchorCombinedPdf::default(),
        };
        let s = InkUndoState {
            undo: vec![create("a"), anchor.clone()],
            redo: Vec::new(),
        };
        let refreshed_state = refresh_ink_undo_annotation(&s, &fresh);
        assert_eq!(
            refreshed_state.undo[0],
            InkUndoEntry::Create { annotation: fresh }
        );
        assert_eq!(refreshed_state.undo[1], anchor);
    }

    #[test]
    fn update_patch_serialises_only_set_fields() {
        let patch = InkUndoPatch {
            color: Some("#ff0000".to_owned()),
            ..InkUndoPatch::default()
        };
        let json = serde_json::to_string(&patch).unwrap_or_default();
        assert_eq!(json, r##"{"color":"#ff0000"}"##);
    }
}
