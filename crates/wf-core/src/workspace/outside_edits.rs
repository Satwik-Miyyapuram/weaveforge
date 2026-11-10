//! Outside-edit triage (`apps/web/.../workspace/application/outside-edits.ts`).
//!
//! An outside edit (made in the connected folder by another program) is taken in
//! without asking only when the folder alone changed that file since the two sides
//! last agreed, and the note is not open in an editor. A JSON data file goes in
//! whole or not at all. Everything else is held for a person to review, with the
//! first reason that holds it.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::sync::change_origin::ChangeSide;
use crate::sync::import_action::ImportAction;

/// Why an outside edit waits for a person (the review-list wording).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum HeldReason {
    #[serde(rename = "removed")]
    /// Removed.
    Removed,
    #[serde(rename = "edited on both sides")]
    /// Edited on both sides.
    EditedOnBothSides,
    #[serde(rename = "no record of the app's write")]
    /// No record of app write.
    NoRecordOfAppWrite,
    #[serde(rename = "a copy of a known note")]
    /// Copy of known note.
    CopyOfKnownNote,
    #[serde(rename = "moved to another folder")]
    /// Moved to another folder.
    MovedToAnotherFolder,
    #[serde(rename = "lost its id")]
    /// Lost id.
    LostId,
    #[serde(rename = "open in editor")]
    /// Open in editor.
    OpenInEditor,
    #[serde(rename = "a data file that cannot go in whole")]
    /// Data file not whole.
    DataFileNotWhole,
}

/// What the preview saw of one folder file: who moved it, and whether its path is new.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeenFile {
    /// Side.
    pub side: ChangeSide,
    /// Neither the last agreement nor the workspace knows this path.
    #[serde(default)]
    pub new_path: bool,
    /// Where the note this new path carries lived, when that file is gone.
    #[serde(default)]
    pub renamed_from: Option<String>,
}

/// One non-unchanged note entry of a folder diff.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "OutsideNoteEntry"))]
pub struct NoteEntry {
    /// Action.
    pub action: ImportAction,
    /// Path.
    pub path: String,
    /// The note is open in an editor (the app resolves this from its id).
    #[serde(default)]
    pub open: bool,
}

/// One non-unchanged JSON row of a folder diff.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "OutsideRowEntry"))]
pub struct RowEntry {
    /// Action.
    pub action: ImportAction,
    /// Path.
    pub path: String,
}

/// The triage input: the changed notes and rows, and what the preview saw by path.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitInput {
    #[serde(default)]
    /// Notes.
    pub notes: Vec<NoteEntry>,
    #[serde(default)]
    /// Ows.
    pub rows: Vec<RowEntry>,
    #[serde(default)]
    /// Seen.
    pub seen: BTreeMap<String, SeenFile>,
}

/// Held flags aligned with the input `notes` and `rows`, and the first reason per path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "OutsideEditSplit"))]
pub struct SplitVerdict {
    /// Note held.
    pub note_held: Vec<bool>,
    /// Ow held.
    pub row_held: Vec<bool>,
    /// Easons.
    pub reasons: BTreeMap<String, HeldReason>,
}

fn dir_of(path: &str) -> &str {
    &path[..path.rfind('/').map_or(0, |i| i + 1)]
}

/// The renamed-from path of a seen file, when it is a real (non-empty) rename.
fn renamed_from(seen: &SeenFile) -> Option<&str> {
    seen.renamed_from.as_deref().filter(|from| !from.is_empty())
}

/// The reason a note entry is held, or `None` when it can be taken in.
fn note_held_reason(note: &NoteEntry, seen: &BTreeMap<String, SeenFile>) -> Option<HeldReason> {
    let known = seen.get(&note.path);
    match note.action {
        ImportAction::Removed => return Some(HeldReason::Removed),
        ImportAction::Conflict => return Some(HeldReason::EditedOnBothSides),
        _ => {}
    }
    // An update from a path neither side knew is a copy carrying a known id
    // ("a copy.md", a sync conflict file): taking it in would overwrite that note.
    let copy = known.filter(|k| note.action == ImportAction::Updated && k.new_path);
    if let Some(copy) = copy {
        match renamed_from(copy) {
            None => return Some(HeldReason::CopyOfKnownNote),
            // A rename keeps its folder; a move would also change the note's parent.
            Some(from) if dir_of(from) != dir_of(&note.path) => {
                return Some(HeldReason::MovedToAnotherFolder);
            }
            Some(_) => {}
        }
    }
    // A note "created" at a known path lost its id (a tool rewrote the
    // frontmatter): taking it in would add a second copy of that note.
    if note.action == ImportAction::Created && known.is_some_and(|k| !k.new_path) {
        return Some(HeldReason::LostId);
    }
    match known {
        None => return Some(HeldReason::NoRecordOfAppWrite),
        Some(k) if k.side == ChangeSide::Unknown => return Some(HeldReason::NoRecordOfAppWrite),
        Some(k) if k.side != ChangeSide::Folder => return Some(HeldReason::EditedOnBothSides),
        Some(_) => {}
    }
    if note.open {
        return Some(HeldReason::OpenInEditor);
    }
    None
}

/// Decide which note and row entries are held for review, and why.
///
/// Notes come first, then rows; the first reason per path wins.
#[must_use]
pub fn split_outside_edits(input: &SplitInput) -> SplitVerdict {
    let seen = &input.seen;
    let mut reasons = BTreeMap::new();

    let mut note_held = Vec::with_capacity(input.notes.len());
    for note in &input.notes {
        let reason = note_held_reason(note, seen);
        if let Some(reason) = reason {
            let _ = reasons.entry(note.path.clone()).or_insert(reason);
        }
        note_held.push(reason.is_some());
    }

    let folder_alone = |path: &str| seen.get(path).is_some_and(|s| s.side == ChangeSide::Folder);
    // A JSON row: a copy at a new path cannot update a known row.
    let takes_in = |action: ImportAction, path: &str| {
        action == ImportAction::Created
            || (action == ImportAction::Updated && !seen.get(path).is_some_and(|s| s.new_path))
    };
    // A file is taken in whole only if every one of its rows is created or updated.
    let blocked: BTreeSet<&str> = input
        .rows
        .iter()
        .filter(|row| !takes_in(row.action, row.path.as_str()))
        .map(|row| row.path.as_str())
        .collect();

    let mut row_held = Vec::with_capacity(input.rows.len());
    for row in &input.rows {
        let taken_in = folder_alone(row.path.as_str()) && !blocked.contains(row.path.as_str());
        if !taken_in {
            let reason = if !folder_alone(row.path.as_str()) {
                match seen.get(&row.path) {
                    Some(s) if s.side != ChangeSide::Unknown => HeldReason::EditedOnBothSides,
                    _ => HeldReason::NoRecordOfAppWrite,
                }
            } else {
                HeldReason::DataFileNotWhole
            };
            let _ = reasons.entry(row.path.clone()).or_insert(reason);
        }
        row_held.push(!taken_in);
    }

    SplitVerdict {
        note_held,
        row_held,
        reasons,
    }
}

/// Paths of renamed notes among `paths` (in order, without repeats), for the apply to
/// retitle and hand back to the mirror.
pub fn renamed_paths(seen: &BTreeMap<String, SeenFile>, paths: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for path in paths {
        let is_rename = seen.get(path).and_then(renamed_from).is_some();
        if is_rename && !out.contains(path) {
            out.push(path.clone());
        }
    }
    out
}
