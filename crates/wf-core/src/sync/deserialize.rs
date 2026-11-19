//! Ports `packages/core/src/workspace/parts-1.ts`: reads the
//! folder's markdown files into entities and diffs them against what is stored.
//!
//! Divergence: the TypeScript looks directory names up on a plain object, so a
//! folder named `constructor` or `__proto__` resolves to a prototype member. Here
//! such a name is simply not a directory.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize, Serializer};
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ParsedEntity {
    /// The `weaveforge-id` the file declares, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub id: Option<String>,
    /// What kind of entity the file is.
    #[serde(rename = "type")]
    pub entity_type: WorkspaceEntityType,
    /// The title, from frontmatter or the file name.
    pub title: String,
    /// The body after frontmatter, leading whitespace removed.
    pub body: String,
    /// The file's path in the folder.
    pub path: String,
    /// Every frontmatter field except the id, type and title.
    #[cfg_attr(feature = "specta", specta(type = std::collections::BTreeMap<String, specta_typescript::Unknown>))]
    pub fields: Map<String, Value>,
    /// `canvas` for a `.canvas` file, which is read back as a canvas page; absent for a note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// True for a canvas whose folder id map is malformed: its id cannot be read, so it is held.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub canvas_map_broken: bool,
}

/// An entity as the workspace stores it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ExistingEntity {
    /// The entity's id.
    pub id: String,
    /// What kind of entity it is.
    #[serde(rename = "type")]
    pub entity_type: WorkspaceEntityType,
    /// The stored title.
    pub title: String,
    /// The stored body.
    pub body: String,
    /// `canvas` for a canvas page; absent for a note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// The folder path the workspace writes this entity to. A file whose id was
    /// taken out is matched back to its entity by this path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// What an import would do with one parsed file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ImportDiffEntry {
    /// The action the import would take.
    pub action: ImportAction,
    /// The parsed file this entry is about.
    pub entity: ParsedEntity,
    /// Why the entry conflicts, shown before anything is written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = String))]
    pub reason: Option<String>,
    /// Which conflict, when the entry is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = ConflictKind))]
    pub kind: Option<ConflictKind>,
    /// The fields a per-field merge could not settle, `body` or a frontmatter
    /// key. Set by the folder import, never by [`diff_workspace`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Vec<String>))]
    pub conflict_fields: Option<Vec<String>>,
    /// What the resolver needs to offer a choice. Set by the folder import,
    /// never by [`diff_workspace`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = ImportMergeDetail))]
    pub merge: Option<ImportMergeDetail>,
}

/// One key both sides moved, with all three sides so a person can pick.
/// `ours` is the workspace's value, `theirs` the folder's.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MergeFieldDispute {
    /// The disputed key.
    pub field: String,
    /// The value when the sides last agreed.
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub base: Value,
    /// The workspace's value.
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub ours: Value,
    /// The folder's value. Absent (`null`) crosses to JS as `undefined`, which is what the
    /// TypeScript side reads for a folder that has no such key.
    #[serde(default, serialize_with = "theirs_js")]
    #[cfg_attr(feature = "specta", specta(type = specta_typescript::Unknown))]
    pub theirs: Value,
}

/// The two copies of a disputed body, as the TypeScript's `bodySides` holds them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct BodySides {
    /// The workspace's copy.
    pub ours: String,
    /// The folder's copy.
    pub theirs: String,
}

/// Writes a `null` as `undefined` (serde `None`), and any other value as itself.
fn theirs_js<S: Serializer>(value: &Value, serializer: S) -> Result<S::Ok, S::Error> {
    match value {
        Value::Null => serializer.serialize_none(),
        other => other.serialize(serializer),
    }
}

/// Writes `body_sides` as `{ ours, theirs }`.
fn body_sides_js<S: Serializer>(
    sides: &Option<(String, String)>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    sides
        .as_ref()
        .map(|(ours, theirs)| BodySides {
            ours: ours.clone(),
            theirs: theirs.clone(),
        })
        .serialize(serializer)
}

/// Reads `{ ours, theirs }` back into the `(ours, theirs)` pair `body_sides_js` writes.
fn body_sides_from_js<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<(String, String)>, D::Error> {
    Ok(Option::<BodySides>::deserialize(deserializer)?.map(|b| (b.ours, b.theirs)))
}

/// What the resolver has to work with for one conflicted file: the merged
/// result plus what is still in dispute.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ImportMergeDetail {
    /// Merged fields, every one-sided change already applied.
    #[cfg_attr(feature = "specta", specta(type = std::collections::BTreeMap<String, specta_typescript::Unknown>))]
    pub fields: Map<String, Value>,
    /// Merged body.
    pub body: String,
    /// Keys both sides moved differently.
    pub disputed: Vec<MergeFieldDispute>,
    /// `(ours, theirs)` bodies, only when the body itself is in dispute.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "body_sides_js",
        deserialize_with = "body_sides_from_js"
    )]
    #[cfg_attr(feature = "specta", specta(type = BodySides))]
    pub body_sides: Option<(String, String)>,
}

/// One preview: an entry per parsed file, with counts.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
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
    if segments.contains(&WORKSPACE_META_DIR) {
        return None;
    }
    let file_name = segments.last().copied().unwrap_or(path);
    if let Some(stem) = file_name.strip_suffix(".canvas") {
        // A canvas is its whole file: no frontmatter, so no id to match it by.
        return Some(ParsedEntity {
            id: None,
            entity_type: WorkspaceEntityType::VaultPage,
            title: or_untitled(strip_id_suffix(stem)),
            body: content.to_owned(),
            path: path.to_owned(),
            fields: Map::new(),
            kind: Some("canvas".to_owned()),
            canvas_map_broken: false,
        });
    }
    if !path.ends_with(".md") {
        return None;
    }
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
        kind: None,
        canvas_map_broken: false,
    })
}

/// Parse every file of a folder, keeping the ones that are entities.
///
/// A canvas takes its page id from the folder's `canvas-ids.json`, because its raw
/// file has no frontmatter to carry one.
#[must_use]
pub fn parse_workspace_folder(files: &[(String, String)]) -> Vec<ParsedEntity> {
    let (canvas_ids, broken_maps) = canvas_id_maps(files);
    files
        .iter()
        .filter_map(|(path, content)| {
            let mut parsed = parse_workspace_file(path, content)?;
            if parsed.kind.as_deref() == Some("canvas") {
                parsed.id = canvas_ids.get(path).cloned();
                parsed.canvas_map_broken = broken_maps
                    .iter()
                    .any(|project| project.is_empty() || path.starts_with(&format!("{project}/")));
            }
            Some(parsed)
        })
        .collect()
}

/// Canvas page ids by full file path, from every `<project>/.weaveforge/canvas-ids.json`,
/// and the projects whose map is malformed (`""` for the folder root).
fn canvas_id_maps(files: &[(String, String)]) -> (HashMap<String, String>, Vec<String>) {
    let map_name = format!("{WORKSPACE_META_DIR}/canvas-ids.json");
    let mut ids = HashMap::new();
    let mut broken = Vec::new();
    for (path, content) in files {
        let project = if *path == map_name {
            ""
        } else if let Some(project) = path.strip_suffix(&format!("/{map_name}")) {
            project
        } else {
            continue;
        };
        let base = if project.is_empty() {
            String::new()
        } else {
            format!("{project}/")
        };
        let Ok(Value::Object(map)) = serde_json::from_str::<Value>(content) else {
            broken.push(project.to_owned());
            continue;
        };
        for (relative, id) in map {
            if let Some(id) = id.as_str() {
                let _ = ids.insert(format!("{base}{relative}"), id.to_owned());
            }
        }
    }
    (ids, broken)
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
    let ids = matched_ids(parsed, existing, &by_id);
    let entries: Vec<ImportDiffEntry> = parsed
        .iter()
        .zip(ids)
        .map(|(entity, id)| match id {
            Some(id) => {
                let entity = ParsedEntity {
                    id: Some(id.to_owned()),
                    ..entity.clone()
                };
                diff_entity(&entity, &by_id, origin)
            }
            None => diff_entity(entity, &by_id, origin),
        })
        .collect();
    let mut counts = ActionCounts::default();
    for entry in &entries {
        counts.add(entry.action, 1);
    }
    ImportDiff { entries, counts }
}

/// The stored id each file without one belongs to, so import never mints a new
/// id over an entity the folder already holds.
///
/// A file that declares an id keeps it, known or not. A file without one is
/// matched first by the path the workspace writes its entity to, then by an
/// identical non-empty body held by exactly one entity. Each entity is matched
/// once, and never when another file declares its id. No match mints a new id.
fn matched_ids<'a>(
    parsed: &[ParsedEntity],
    existing: &'a [ExistingEntity],
    by_id: &HashMap<&str, &'a ExistingEntity>,
) -> Vec<Option<&'a str>> {
    let mut taken: HashSet<&str> = parsed
        .iter()
        .filter_map(|entity| entity.id.as_deref())
        .filter(|id| !id.is_empty())
        .filter_map(|id| by_id.get(id).map(|current| current.id.as_str()))
        .collect();
    let unclaimed = |entity: &ParsedEntity| entity.id.as_deref().is_none_or(str::is_empty);
    let same_kind = |entity: &ParsedEntity, current: &ExistingEntity| {
        current.entity_type == entity.entity_type && current.kind == entity.kind
    };
    let mut ids: Vec<Option<&'a str>> = vec![None; parsed.len()];
    // Path first, over every file, so a content match never takes a note its own file sits on.
    for (slot, entity) in ids.iter_mut().zip(parsed) {
        if !unclaimed(entity) {
            continue;
        }
        let found = existing.iter().rev().find(|current| {
            current.path.as_deref() == Some(entity.path.as_str())
                && same_kind(entity, current)
                && !taken.contains(current.id.as_str())
        });
        if let Some(current) = found {
            let _ = taken.insert(current.id.as_str());
            *slot = Some(current.id.as_str());
        }
    }
    for (slot, entity) in ids.iter_mut().zip(parsed) {
        let body = trim_js(&entity.body);
        if !unclaimed(entity) || slot.is_some() || body.is_empty() {
            continue;
        }
        let mut same = existing.iter().filter(|current| {
            same_kind(entity, current)
                && !taken.contains(current.id.as_str())
                && trim_js(&current.body) == body
        });
        if let (Some(current), None) = (same.next(), same.next()) {
            let _ = taken.insert(current.id.as_str());
            *slot = Some(current.id.as_str());
        }
    }
    ids
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
    if entity.canvas_map_broken {
        return conflict(
            entity,
            ConflictKind::BrokenMap,
            format!(
                "The canvas id map for {} cannot be read, so the canvas is held. Repair or remove .weaveforge/canvas-ids.json.",
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
    if let Some(mismatch) = canvas_kind_mismatch(entity, current) {
        return mismatch;
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

/// A canvas page and a note never share an id: the canvas map cannot point at a note.
fn canvas_kind_mismatch(
    entity: &ParsedEntity,
    current: &ExistingEntity,
) -> Option<ImportDiffEntry> {
    if (current.kind.as_deref() == Some("canvas")) != (entity.kind.as_deref() == Some("canvas")) {
        let describe = |kind: Option<&str>| {
            if kind == Some("canvas") {
                "canvas page".to_owned()
            } else {
                "note".to_owned()
            }
        };
        return Some(conflict(
            entity,
            ConflictKind::TypeMismatch,
            format!(
                "The id in {} belongs to a {}, not a {}.",
                entity.path,
                describe(current.kind.as_deref()),
                describe(entity.kind.as_deref())
            ),
        ));
    }
    None
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parsed_entity_round_trips_with_ts_field_names() {
        let entity = ParsedEntity {
            id: None,
            entity_type: WorkspaceEntityType::VaultPage,
            title: "T".into(),
            body: "B".into(),
            path: "notes/t.md".into(),
            fields: json!({"tags": ["a"]}).as_object().unwrap().clone(),
            kind: None,
            canvas_map_broken: false,
        };
        let value = json!({"type":"vault_page","title":"T","body":"B","path":"notes/t.md","fields":{"tags":["a"]}});
        assert_eq!(serde_json::to_value(&entity).unwrap(), value);
        assert_eq!(
            serde_json::from_value::<ParsedEntity>(value).unwrap(),
            entity
        );
    }

    #[test]
    fn merge_detail_writes_body_sides_as_an_object() {
        let detail = ImportMergeDetail {
            fields: Map::new(),
            body: "x".into(),
            disputed: vec![],
            body_sides: Some(("o".into(), "t".into())),
        };
        assert_eq!(
            serde_json::to_value(&detail).unwrap(),
            json!({"fields":{},"body":"x","disputed":[],"bodySides":{"ours":"o","theirs":"t"}})
        );
        let without = ImportMergeDetail {
            body_sides: None,
            ..detail
        };
        assert!(
            serde_json::to_value(&without)
                .unwrap()
                .get("bodySides")
                .is_none()
        );
    }

    #[test]
    fn diff_entry_omits_absent_options_and_spells_conflict_fields() {
        let entry = ImportDiffEntry {
            action: ImportAction::Conflict,
            entity: ParsedEntity {
                id: None,
                entity_type: WorkspaceEntityType::VaultPage,
                title: "T".into(),
                body: "B".into(),
                path: "notes/t.md".into(),
                fields: Map::new(),
                kind: None,
                canvas_map_broken: false,
            },
            reason: None,
            kind: Some(ConflictKind::BothChanged),
            conflict_fields: Some(vec!["title".into()]),
            merge: None,
        };
        let value = serde_json::to_value(&entry).unwrap();
        assert_eq!(value["action"], json!("conflict"));
        assert_eq!(value["kind"], json!("both-changed"));
        assert_eq!(value["conflictFields"], json!(["title"]));
        assert!(value.get("reason").is_none());
        assert!(value.get("merge").is_none());
    }
}
