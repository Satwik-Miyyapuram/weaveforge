//! Folder-diff helpers (`apps/web/.../workspace/application/folder-diff.ts`).
//!
//! Which new folder paths are renames of a note's old file, and what each folder
//! file said since the two sides last agreed. Digests are computed here from the
//! text, with the same hash the mirror manifest records.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::sync::change_origin::{ChangeOrigin, ChangeSide, changed_side, digest_text};
use crate::sync::deserialize::ParsedEntity as FileEntity;
use crate::sync::folder_layout::WorkspaceEntityType;

/// A parsed folder entity: its note id (when it has one) and its folder path.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[cfg_attr(feature = "specta", serde(rename = "FolderParsedEntity"))]
pub struct ParsedEntity {
    /// Note id the file carries, when any.
    #[serde(default)]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub id: Option<String>,
    /// Folder path of the file.
    pub path: String,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// What one folder file said: who moved it since the sides last agreed, and its digest now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSeen {
    /// Side that changed the file.
    pub side: ChangeSide,
    /// Digest read now.
    pub digest: String,
    /// Neither the last agreement nor the workspace knows this path.
    #[serde(skip_serializing_if = "is_false")]
    pub new_path: bool,
    /// Where the note this new path carries lived, when that file is gone.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renamed_from: Option<String>,
}

/// New folder paths that are renames: the only folder file carrying a note's id,
/// while the file the mirror wrote for that note is gone. With the old file still
/// there, the new one is a copy. Maps new path to old.
///
/// When several current files carry the same stamp, the first by path order wins.
#[must_use]
pub fn rename_sources(
    parsed: &[ParsedEntity],
    folder: &BTreeMap<String, String>,
    current: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut paths_by_id: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for entity in parsed {
        if let Some(id) = entity.id.as_deref().filter(|id| !id.is_empty()) {
            paths_by_id
                .entry(id)
                .or_default()
                .push(entity.path.as_str());
        }
    }
    let mut renamed = BTreeMap::new();
    for (id, paths) in paths_by_id {
        let [path] = paths.as_slice() else {
            continue;
        };
        if path.is_empty() || current.contains_key(*path) {
            continue;
        }
        let stamp = format!("\nweaveforge-id: {id}\n");
        let old = current
            .iter()
            .find(|(key, text)| key.ends_with(".md") && text.contains(&stamp))
            .map(|(key, _)| key);
        if let Some(old) = old
            && !folder.contains_key(old)
        {
            let _ = renamed.insert((*path).to_owned(), old.clone());
        }
    }
    renamed
}

/// Who moved each folder file since the two sides last agreed, and the digest read now.
///
/// `base` holds the digests the last mirror run wrote; an empty digest reads as
/// unknown. A file neither the base nor the workspace knows is new in the folder:
/// the folder alone made it.
#[must_use]
pub fn seen_files(
    folder: &BTreeMap<String, String>,
    current: &BTreeMap<String, String>,
    base: &BTreeMap<String, String>,
    renamed: &BTreeMap<String, String>,
) -> BTreeMap<String, FolderSeen> {
    folder
        .iter()
        .map(|(path, text)| {
            let digest = digest_text(text);
            let known = base
                .get(path)
                .map(String::as_str)
                .filter(|known| !known.is_empty());
            let workspace = current.get(path).map(|text| digest_text(text));
            let new_path = known.is_none() && workspace.is_none();
            let side = if new_path {
                ChangeSide::Folder
            } else {
                changed_side(ChangeOrigin {
                    base: known,
                    folder: Some(&digest),
                    workspace: workspace.as_deref(),
                })
            };
            let seen = FolderSeen {
                side,
                digest,
                new_path,
                renamed_from: if new_path {
                    renamed.get(path).cloned()
                } else {
                    None
                },
            };
            (path.clone(), seen)
        })
        .collect()
}

/// The folder files a folder import may bring in: vault pages, and any file whose note id is
/// one the workspace already has (a note of another type that was renamed or copied).
/// Keeps the input order.
#[must_use]
pub fn importable_entities(entities: &[FileEntity], note_ids: &HashSet<String>) -> Vec<FileEntity> {
    entities
        .iter()
        .filter(|entity| {
            matches!(entity.entity_type, WorkspaceEntityType::VaultPage)
                || entity
                    .id
                    .as_deref()
                    .is_some_and(|id| !id.is_empty() && note_ids.contains(id))
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    fn file(id: Option<&str>, entity_type: WorkspaceEntityType, path: &str) -> FileEntity {
        FileEntity {
            id: id.map(str::to_owned),
            entity_type,
            title: "t".to_owned(),
            body: String::new(),
            path: path.to_owned(),
            fields: serde_json::Map::new(),
        }
    }

    #[test]
    fn importable_keeps_vault_pages_and_known_ids_in_order() {
        let entities = vec![
            file(Some("p1"), WorkspaceEntityType::Paper, "papers/a.md"),
            file(None, WorkspaceEntityType::VaultPage, "notes/b.md"),
            file(Some("known"), WorkspaceEntityType::Milestone, "m/c.md"),
            file(Some("unknown"), WorkspaceEntityType::Milestone, "m/d.md"),
            file(Some("known"), WorkspaceEntityType::VaultPage, "notes/e.md"),
        ];
        let note_ids: HashSet<String> = ["known".to_owned()].into_iter().collect();
        let paths: Vec<String> = importable_entities(&entities, &note_ids)
            .into_iter()
            .map(|entity| entity.path)
            .collect();
        assert_eq!(paths, vec!["notes/b.md", "m/c.md", "notes/e.md"]);
    }

    #[test]
    fn importable_ignores_empty_id_even_when_listed() {
        // TS `e.id && noteIds.has(e.id)`: an empty id is falsy, so it never matches.
        let entities = vec![file(Some(""), WorkspaceEntityType::Paper, "p/x.md")];
        let note_ids: HashSet<String> = [String::new()].into_iter().collect();
        assert!(importable_entities(&entities, &note_ids).is_empty());
    }

    #[test]
    fn rename_when_old_file_gone_and_copy_when_present() {
        let parsed = vec![ParsedEntity {
            id: Some("a".to_owned()),
            path: "n/a2.note.md".to_owned(),
        }];
        let current = map(&[("n/a.note.md", "x\nweaveforge-id: a\ny")]);
        let folder = map(&[("n/a2.note.md", "x")]);
        let renamed = rename_sources(&parsed, &folder, &current);
        assert_eq!(
            renamed.get("n/a2.note.md").map(String::as_str),
            Some("n/a.note.md")
        );

        let folder_with_old = map(&[("n/a2.note.md", "x"), ("n/a.note.md", "x")]);
        assert!(rename_sources(&parsed, &folder_with_old, &current).is_empty());
    }

    #[test]
    fn new_path_is_folder_side_with_rename_source() {
        let folder = map(&[("n/a2.note.md", "x")]);
        let current = BTreeMap::new();
        let base = BTreeMap::new();
        let renamed = map(&[("n/a2.note.md", "n/a.note.md")]);
        let seen = seen_files(&folder, &current, &base, &renamed);
        let entry = &seen["n/a2.note.md"];
        assert!(entry.new_path);
        assert_eq!(entry.side, ChangeSide::Folder);
        assert_eq!(entry.renamed_from.as_deref(), Some("n/a.note.md"));
    }
}
