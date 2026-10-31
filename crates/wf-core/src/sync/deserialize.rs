//! Ports `packages/core/src/workspace/deserialize-workspace.ts`: reads the
//! folder's markdown files into entities and diffs them against what is stored.
//!
//! Divergence: `fields` is a `serde_json::Map`, which keeps keys sorted, where the
//! TypeScript keeps frontmatter order. The diff does not depend on that order.
//!
//! Divergence: the TypeScript looks directory names up on a plain object, so a
//! folder named `constructor` or `__proto__` resolves to a prototype member. Here
//! such a name is simply not a directory.

use std::collections::HashMap;

use serde_json::{Map, Value};

use crate::search::js_text::is_js_whitespace;
use crate::sync::change_origin::ChangeSide;
use crate::sync::folder_layout::{
    ENTITY_DIRS, WORKSPACE_META_DIR, WorkspaceEntityType, parse_kind_suffix, strip_kind_suffix,
};
use crate::sync::frontmatter::{ParsedDocument, frontmatter_string, read_frontmatter};
use crate::sync::import_action::{ActionCounts, ConflictKind, ImportAction};
use crate::sync::ink_note::{read_ink_note_meta, write_ink_note_body};
use crate::sync::text_diff::has_conflict_markers;

/// Frontmatter keys that are not fields: the id, the type and the title.
const RESERVED_KEYS: [&str; 3] = ["weaveforge-id", "weaveforge-type", "title"];

/// Every entity type, for reading a declared `weaveforge-type`.
const ALL_TYPES: [WorkspaceEntityType; 8] = [
    WorkspaceEntityType::VaultPage,
    WorkspaceEntityType::InkPage,
    WorkspaceEntityType::Paper,
    WorkspaceEntityType::ReadingList,
    WorkspaceEntityType::ReportSection,
    WorkspaceEntityType::Experiment,
    WorkspaceEntityType::Milestone,
    WorkspaceEntityType::LogEntry,
];

/// A markdown file in the folder, read as an entity.
#[derive(Clone, Debug, PartialEq)]
pub struct ParsedEntity {
    /// The `weaveforge-id` the file declares, if any.
    pub id: Option<String>,
    /// What kind of entity the file is.
    pub entity_type: WorkspaceEntityType,
    /// The title, from frontmatter or the file name.
    pub title: String,
    /// The body after frontmatter, leading whitespace removed.
    pub body: String,
    /// The file's path in the folder.
    pub path: String,
    /// Every frontmatter field except the id, type and title.
    pub fields: Map<String, Value>,
}

/// An entity as the workspace stores it.
#[derive(Clone, Debug, PartialEq)]
pub struct ExistingEntity {
    /// The entity's id.
    pub id: String,
    /// What kind of entity it is.
    pub entity_type: WorkspaceEntityType,
    /// The stored title.
    pub title: String,
    /// The stored body.
    pub body: String,
}

/// What an import would do with one parsed file.
#[derive(Clone, Debug, PartialEq)]
pub struct ImportDiffEntry {
    /// The action the import would take.
    pub action: ImportAction,
    /// The parsed file this entry is about.
    pub entity: ParsedEntity,
    /// Why the entry conflicts, shown before anything is written.
    pub reason: Option<String>,
    /// Which conflict, when the entry is one.
    pub kind: Option<ConflictKind>,
    /// The fields a per-field merge could not settle, `body` or a frontmatter
    /// key. Set by the folder import, never by [`diff_workspace`].
    pub conflict_fields: Option<Vec<String>>,
    /// What the resolver needs to offer a choice. Set by the folder import,
    /// never by [`diff_workspace`].
    pub merge: Option<ImportMergeDetail>,
}

/// One key both sides moved, with all three sides so a person can pick.
/// `ours` is the workspace's value, `theirs` the folder's.
#[derive(Clone, Debug, PartialEq)]
pub struct MergeFieldDispute {
    /// The disputed key.
    pub field: String,
    /// The value when the sides last agreed.
    pub base: Value,
    /// The workspace's value.
    pub ours: Value,
    /// The folder's value.
    pub theirs: Value,
}

/// What the resolver has to work with for one conflicted file: the merged
/// result plus what is still in dispute.
#[derive(Clone, Debug, PartialEq)]
pub struct ImportMergeDetail {
    /// Merged fields, every one-sided change already applied.
    pub fields: Map<String, Value>,
    /// Merged body.
    pub body: String,
    /// Keys both sides moved differently.
    pub disputed: Vec<MergeFieldDispute>,
    /// `(ours, theirs)` bodies, only when the body itself is in dispute.
    pub body_sides: Option<(String, String)>,
}

/// One preview: an entry per parsed file, with counts.
#[derive(Clone, Debug, PartialEq)]
pub struct ImportDiff {
    /// One entry per parsed file, in file order.
    pub entries: Vec<ImportDiffEntry>,
    /// How many entries of each action.
    pub counts: ActionCounts,
}

/// Parse one file of the folder, or `None` when it is not an entity.
///
/// Bookkeeping under `.weaveforge/`, non-markdown files and `README.md` never are.
#[must_use]
pub fn parse_workspace_file(path: &str, content: &str) -> Option<ParsedEntity> {
    let segments: Vec<&str> = path.split('/').collect();
    if segments.contains(&WORKSPACE_META_DIR) || !path.ends_with(".md") {
        return None;
    }
    let file_name = segments.last().copied().unwrap_or(path);
    if file_name == "README.md" {
        return None;
    }
    let ParsedDocument { frontmatter, body } = read_frontmatter(content);
    let entity_type = frontmatter_string(&frontmatter, "weaveforge-type")
        .as_deref()
        .and_then(entity_type_from_str)
        .or_else(|| segments.first().and_then(|dir| type_for_dir(dir)))
        .or_else(|| segments.get(1).and_then(|dir| type_for_dir(dir)))
        .or_else(|| parse_kind_suffix(path))?;

    let id = frontmatter_string(&frontmatter, "weaveforge-id");
    let title =
        frontmatter_string(&frontmatter, "title").unwrap_or_else(|| fallback_title(file_name));
    let title = or_untitled(&title);
    let (entity_type, body) = if entity_type == WorkspaceEntityType::InkPage {
        let meta = read_ink_note_meta(&frontmatter);
        (
            WorkspaceEntityType::VaultPage,
            write_ink_note_body(&meta, trim_start_js(&body)),
        )
    } else {
        (entity_type, trim_start_js(&body).to_owned())
    };
    let fields = frontmatter
        .into_iter()
        .filter(|(key, _)| !RESERVED_KEYS.contains(&key.as_str()))
        .collect();

    Some(ParsedEntity {
        id,
        entity_type,
        title,
        body,
        path: path.to_owned(),
        fields,
    })
}

/// Parse every file of a folder, keeping the ones that are entities.
#[must_use]
pub fn parse_workspace_folder(files: &[(String, String)]) -> Vec<ParsedEntity> {
    files
        .iter()
        .filter_map(|(path, content)| parse_workspace_file(path, content))
        .collect()
}

/// Compare parsed files with what is stored, by id.
///
/// `origin` says which side changed a file since the two last agreed. Without it,
/// a difference is treated as unknown and is an update.
#[must_use]
pub fn diff_workspace(
    parsed: &[ParsedEntity],
    existing: &[ExistingEntity],
    origin: Option<&dyn Fn(&str) -> ChangeSide>,
) -> ImportDiff {
    // Last stored entity wins for a repeated id, as the TypeScript Map does.
    let by_id: HashMap<&str, &ExistingEntity> = existing
        .iter()
        .map(|entity| (entity.id.as_str(), entity))
        .collect();
    let entries: Vec<ImportDiffEntry> = parsed
        .iter()
        .map(|entity| diff_entity(entity, &by_id, origin))
        .collect();
    let mut counts = ActionCounts::default();
    for entry in &entries {
        counts.add(entry.action, 1);
    }
    ImportDiff { entries, counts }
}

fn diff_entity(
    entity: &ParsedEntity,
    by_id: &HashMap<&str, &ExistingEntity>,
    origin: Option<&dyn Fn(&str) -> ChangeSide>,
) -> ImportDiffEntry {
    // Markers are checked before the id: a marked file is never an ordinary update.
    if has_conflict_markers(&entity.body) {
        return conflict(
            entity,
            ConflictKind::Markers,
            format!(
                "{} still holds conflict markers. Take them out in the folder and it imports as an ordinary edit.",
                entity.path
            ),
        );
    }
    let Some(current) = entity
        .id
        .as_deref()
        // An empty id is falsy in the TypeScript: a creation, never a lookup.
        .filter(|id| !id.is_empty())
        .and_then(|id| by_id.get(id).copied())
    else {
        return action(entity, ImportAction::Created);
    };
    if current.entity_type != entity.entity_type {
        return conflict(
            entity,
            ConflictKind::TypeMismatch,
            format!(
                "The id in {} belongs to a {}, not a {}.",
                entity.path,
                current.entity_type.as_str(),
                entity.entity_type.as_str()
            ),
        );
    }
    let same_title = trim_js(&current.title) == trim_js(&entity.title);
    let same_body = trim_js(&current.body) == trim_js(&entity.body);
    if same_title && same_body {
        return action(entity, ImportAction::Unchanged);
    }
    let side = origin.map_or(ChangeSide::Unknown, |f| f(&entity.path));
    match side {
        ChangeSide::Workspace | ChangeSide::Neither => action(entity, ImportAction::Unchanged),
        ChangeSide::Both => conflict(
            entity,
            ConflictKind::BothChanged,
            format!(
                "{} changed both in the folder and in the workspace since they last agreed.",
                entity.path
            ),
        ),
        ChangeSide::Folder | ChangeSide::Unknown => action(entity, ImportAction::Updated),
    }
}

fn action(entity: &ParsedEntity, action: ImportAction) -> ImportDiffEntry {
    ImportDiffEntry {
        action,
        entity: entity.clone(),
        reason: None,
        kind: None,
        conflict_fields: None,
        merge: None,
    }
}

fn conflict(entity: &ParsedEntity, kind: ConflictKind, reason: String) -> ImportDiffEntry {
    ImportDiffEntry {
        action: ImportAction::Conflict,
        entity: entity.clone(),
        reason: Some(reason),
        kind: Some(kind),
        conflict_fields: None,
        merge: None,
    }
}

/// The type a directory name stands for. Ink notes share `notes/`, so `notes`
/// stands for a plain note.
fn type_for_dir(dir: &str) -> Option<WorkspaceEntityType> {
    ENTITY_DIRS.iter().find_map(|&(entity, name)| {
        (entity != WorkspaceEntityType::InkPage && name == dir).then_some(entity)
    })
}

fn entity_type_from_str(name: &str) -> Option<WorkspaceEntityType> {
    ALL_TYPES.into_iter().find(|entity| entity.as_str() == name)
}

/// The title a file name gives when frontmatter has none: kind suffix and id
/// suffix removed.
fn fallback_title(file_name: &str) -> String {
    strip_id_suffix(&strip_kind_suffix(file_name)).to_owned()
}

/// Drops a trailing `--` plus 1 to 8 ASCII alphanumerics, the id suffix a
/// filename may carry.
fn strip_id_suffix(name: &str) -> &str {
    let tail = name.trim_end_matches(|c: char| c.is_ascii_alphanumeric());
    let run_len = name.len() - tail.len();
    if !(1..=8).contains(&run_len) {
        return name;
    }
    tail.strip_suffix("--").unwrap_or(name)
}

fn or_untitled(title: &str) -> String {
    let trimmed = trim_js(title);
    if trimmed.is_empty() {
        "Untitled".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// Trims JS whitespace on both ends, which is not `str::trim` for every char.
fn trim_js(text: &str) -> &str {
    text.trim_matches(is_js_whitespace)
}

fn trim_start_js(text: &str) -> &str {
    text.trim_start_matches(is_js_whitespace)
}
