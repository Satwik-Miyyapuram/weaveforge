//! Ports `packages/core/src/workspace/json-entities.ts`: the project's JSON data
//! files (`relations.json`, `tags.json`, `reading-list-items.json`), parsed and
//! diffed by id. Pure: the caller reads the files and applies the result.
//!
//! Divergence: `serde_json::Map` keeps keys sorted, so nested object key order
//! is ignored when comparing rows, where `JSON.stringify` would see a reorder.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};

use crate::sync::change_origin::ChangeSide;
use crate::sync::folder_layout::{WORKSPACE_META_DIR, project_meta_dir};
use crate::sync::import_action::{ActionCounts, ConflictKind, ImportAction};

/// A row as the file spells it: a JSON object with a string `id`.
pub type JsonRow = Map<String, Value>;

/// The three JSON data files, by what they hold.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkspaceJsonKind {
    /// `relations.json`.
    Relations,
    /// `tags.json`.
    Tags,
    /// `reading-list-items.json`.
    ReadingListItems,
}

/// The three, in the order the mirror writes them. Membership is last because
/// a paper in a list refers to a list.
pub const JSON_KINDS: [WorkspaceJsonKind; 3] = [
    WorkspaceJsonKind::Relations,
    WorkspaceJsonKind::Tags,
    WorkspaceJsonKind::ReadingListItems,
];

impl WorkspaceJsonKind {
    /// The file name each kind is written to.
    #[must_use]
    pub const fn file_name(self) -> &'static str {
        match self {
            Self::Relations => "relations.json",
            Self::Tags => "tags.json",
            Self::ReadingListItems => "reading-list-items.json",
        }
    }
}

/// `<project>/.weaveforge/relations.json`
#[must_use]
pub fn json_data_path(project_root: &str, kind: WorkspaceJsonKind) -> String {
    format!("{}/{}", project_meta_dir(project_root), kind.file_name())
}

/// The kind a path names, or `None` when it is not one of the three.
#[must_use]
pub fn json_kind_of_path(path: &str) -> Option<WorkspaceJsonKind> {
    let name = path.rsplit('/').next().unwrap_or(path);
    JSON_KINDS
        .iter()
        .copied()
        .find(|kind| kind.file_name() == name)
}

/// Directories under a `.weaveforge/` that are the app's own and never data.
const MACHINERY_DIRS: [&str; 3] = ["db", "db-backups", "cache"];
/// Files that are the app's record of what it wrote, never something to import.
const MACHINERY_FILES: [&str; 2] = ["mirror.json", "manifest.json"];
/// Folders under `papers/` that cache downloads, never data.
const CACHE_DIRS: [&str; 2] = ["pdf", "html"];

/// Whether a changed folder path is the app's own machinery.
///
/// The three data files are not machinery: they are data the app stores as JSON.
#[must_use]
pub fn is_app_owned_path(path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').collect();
    let at = |i: usize| parts.get(i).copied().unwrap_or("");
    let name = parts.last().copied().unwrap_or("");
    // The folder's git history and its root README are written by the mirror itself.
    if parts.contains(&".git") || path == "README.md" {
        return true;
    }
    let meta_at = parts.iter().rposition(|p| *p == WORKSPACE_META_DIR);
    if meta_at.is_some_and(|m| MACHINERY_DIRS.contains(&at(m + 1))) {
        return true;
    }
    if MACHINERY_FILES.contains(&name) {
        return true;
    }
    // Downloaded paper PDFs and HTML snapshots are caches the app fills itself.
    let cache_at = parts.iter().rposition(|p| *p == "papers");
    if cache_at.is_some_and(|c| CACHE_DIRS.contains(&at(c + 1))) {
        return true;
    }
    // Anything else directly in a `.weaveforge/` is bookkeeping, except the data files.
    meta_at.is_some_and(|m| parts.len() == m + 2) && json_kind_of_path(path).is_none()
}

/// One of the three files, read: its rows that have a non-empty string id.
#[derive(Clone, Debug, PartialEq)]
pub struct ParsedJsonData {
    /// Which file this is.
    pub kind: WorkspaceJsonKind,
    /// Where the file was read from.
    pub path: String,
    /// The rows with a non-empty string id, in file order.
    pub rows: Vec<JsonRow>,
}

/// Read one of the three files.
///
/// `None` when the content is not a JSON array: a truncated write, a file of
/// another shape. `None` means "say nothing about this file", never "empty",
/// so a syntax error cannot read as a deletion of everything.
#[must_use]
pub fn parse_json_data(
    path: &str,
    content: &str,
    kind: WorkspaceJsonKind,
) -> Option<ParsedJsonData> {
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(content) else {
        return None;
    };
    let rows = items
        .into_iter()
        .filter_map(|item| {
            let Value::Object(map) = item else {
                return None;
            };
            if row_id(&map).is_none_or(str::is_empty) {
                return None;
            }
            Some(map)
        })
        .collect();
    Some(ParsedJsonData {
        kind,
        path: path.to_owned(),
        rows,
    })
}

/// A row's `id`, when it is a string.
fn row_id(row: &JsonRow) -> Option<&str> {
    row.get("id").and_then(Value::as_str)
}

/// Field equality as `JSON.stringify` sees it: an absent key matches only an
/// absent key (JS `undefined`), never `null`.
fn same_field(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => same_json(a, b),
        (None, None) => true,
        _ => false,
    }
}

/// Deep JSON equality. JS has one number type, so `1` and `1.0` are equal, and
/// `JSON.stringify` prints `-0` as `0`, so those are equal too (JSON has no NaN).
fn same_json(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            #[allow(
                clippy::float_cmp,
                reason = "exact equality is what JSON.stringify compares"
            )]
            let equal = x.as_f64().zip(y.as_f64()).is_some_and(|(p, q)| p == q);
            equal
        }
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same_json(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| same_json(v, w)))
        }
        _ => a == b,
    }
}

/// Two rows are the same row when every field matches.
fn same_row(a: &JsonRow, b: &JsonRow) -> bool {
    a.keys()
        .chain(b.keys())
        .all(|key| same_field(a.get(key), b.get(key)))
}

/// One comparison outcome for a row or a removal.
#[derive(Clone, Debug, PartialEq)]
pub struct JsonDiffEntry {
    /// What the import would do.
    pub action: ImportAction,
    /// Which file the entry came from.
    pub kind: WorkspaceJsonKind,
    /// Which file the entry came from, as a path.
    pub path: String,
    /// The row as the folder has it. `None` on a removal.
    pub row: Option<JsonRow>,
    /// The stored row this entry is about: what exists, or what would go.
    pub existing: JsonRow,
    /// Why an entry is a conflict, shown before anything is written.
    pub reason: Option<String>,
    /// Which conflict, when the entry is one.
    pub conflict_kind: Option<ConflictKind>,
}

/// The entries for one file, with their counts.
#[derive(Clone, Debug, PartialEq)]
pub struct JsonDiff {
    /// Every row and removal, in comparison order.
    pub entries: Vec<JsonDiffEntry>,
    /// How many entries of each action.
    pub counts: ActionCounts,
}

/// The empty diff.
pub const EMPTY_JSON_DIFF: JsonDiff = JsonDiff {
    entries: Vec::new(),
    counts: ActionCounts {
        created: 0,
        updated: 0,
        unchanged: 0,
        conflict: 0,
        removed: 0,
    },
};

fn entry(
    parsed: &ParsedJsonData,
    action: ImportAction,
    row: Option<&JsonRow>,
    existing: &JsonRow,
) -> JsonDiffEntry {
    JsonDiffEntry {
        action,
        kind: parsed.kind,
        path: parsed.path.clone(),
        row: row.cloned(),
        existing: existing.clone(),
        reason: None,
        conflict_kind: None,
    }
}

/// Entries for the file's rows, matched by id against what is stored.
fn diff_rows(
    parsed: &ParsedJsonData,
    by_id: &HashMap<&str, &JsonRow>,
    side: ChangeSide,
    stale: bool,
) -> Vec<JsonDiffEntry> {
    let mut entries = Vec::with_capacity(parsed.rows.len());
    for row in &parsed.rows {
        let current = row_id(row).and_then(|id| by_id.get(id).copied());
        let action = match current {
            None if stale => ImportAction::Unchanged,
            None => ImportAction::Created,
            Some(stored) if stale || same_row(row, stored) => ImportAction::Unchanged,
            Some(_) if side == ChangeSide::Both => ImportAction::Conflict,
            Some(_) => ImportAction::Updated,
        };
        let mut next = entry(parsed, action, Some(row), current.unwrap_or(row));
        if action == ImportAction::Conflict {
            next.reason = Some(format!(
                "{} changed both in the folder and in the workspace since they last agreed.",
                parsed.path
            ));
            next.conflict_kind = Some(ConflictKind::BothChanged);
        }
        entries.push(next);
    }
    entries
}

/// Entries for stored rows the file no longer lists: removals, or silence when stale.
fn diff_removals(parsed: &ParsedJsonData, existing: &[JsonRow], stale: bool) -> Vec<JsonDiffEntry> {
    let listed: HashSet<&str> = parsed.rows.iter().filter_map(row_id).collect();
    existing
        .iter()
        .filter(|current| !row_id(current).is_some_and(|id| listed.contains(id)))
        .map(|current| {
            if stale {
                entry(parsed, ImportAction::Unchanged, Some(current), current)
            } else {
                entry(parsed, ImportAction::Removed, None, current)
            }
        })
        .collect()
}

/// Compare one file's rows against what is stored, by id.
///
/// The rules are the markdown import's:
///
/// - an id nothing has is a creation, unless the folder is stale,
/// - a row that matches is unchanged,
/// - a row that differs is an update when the folder moved it, unchanged when
///   the workspace did, and a conflict when both did,
/// - a stored row the file no longer lists is a removal, unless the folder is stale.
///
/// `origin` says who changed the file since the last sync. Without it, every
/// difference is the reader's to judge.
#[must_use]
pub fn diff_json_data(
    parsed: &ParsedJsonData,
    existing: &[JsonRow],
    origin: Option<&dyn Fn(&str) -> ChangeSide>,
) -> JsonDiff {
    let side = origin.map_or(ChangeSide::Unknown, |f| f(&parsed.path));
    // The file is stale, not edited: rows sync added or dropped since the mirror are not the reader's.
    let stale = matches!(side, ChangeSide::Workspace | ChangeSide::Neither);
    let by_id: HashMap<&str, &JsonRow> = existing
        .iter()
        .filter_map(|row| row_id(row).map(|id| (id, row)))
        .collect();

    let mut entries = diff_rows(parsed, &by_id, side, stale);
    entries.extend(diff_removals(parsed, existing, stale));
    let counts = count_json_actions(&entries);
    JsonDiff { entries, counts }
}

/// How many entries there are of each action.
#[must_use]
pub fn count_json_actions(entries: &[JsonDiffEntry]) -> ActionCounts {
    let mut counts = ActionCounts::default();
    for entry in entries {
        counts.add(entry.action, 1);
    }
    counts
}

/// Sum two sets of counts, for one preview showing both halves.
#[must_use]
pub fn add_counts(a: ActionCounts, b: ActionCounts) -> ActionCounts {
    ActionCounts {
        created: a.created.saturating_add(b.created),
        updated: a.updated.saturating_add(b.updated),
        unchanged: a.unchanged.saturating_add(b.unchanged),
        conflict: a.conflict.saturating_add(b.conflict),
        removed: a.removed.saturating_add(b.removed),
    }
}
