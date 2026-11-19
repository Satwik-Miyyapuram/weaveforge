//! The in-memory index: entries keyed by path, plus relations per project.
//! Holds no files and writes nothing; it is rebuilt from the workspace files.

use std::collections::BTreeMap;

/// One indexed workspace file.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct IndexEntry {
    /// The entity id the file declares.
    pub id: String,
    /// The file's path in the workspace.
    pub path: String,
    /// The entity kind, as the parser names it.
    pub kind: String,
    /// The project the file sits in, if any.
    pub project_id: Option<String>,
    /// The title, from frontmatter or the file name.
    pub title: String,
    /// The file's tags.
    pub tags: Vec<String>,
    /// Ids the body links to with `[[id]]`.
    pub links: Vec<String>,
    /// The `wf` format version the file declares, if any.
    pub wf: Option<u64>,
    /// True when the file must not be written.
    pub read_only: bool,
    /// True when another live file shares this id.
    pub duplicate: bool,
    /// The id of the file this is a conflict copy of, if any.
    pub conflict_of: Option<String>,
    /// Digest of the file's canonical text.
    pub digest: String,
}

/// A typed link between two entities.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Relation {
    /// The id the relation starts from.
    pub source_id: String,
    /// The id the relation points to.
    pub target_id: String,
    /// The relation's type, such as `cites`.
    pub relation_type: String,
}

/// The index: one entry per path, and every project's relations.
#[derive(Debug, Default)]
pub struct IndexStore {
    by_path: BTreeMap<String, IndexEntry>,
    relations: Vec<(String, Relation)>,
}

impl IndexStore {
    /// An empty index.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Insert or replace the entry at its path, then refresh duplicate flags.
    pub fn upsert(&mut self, entry: IndexEntry) {
        let id = entry.id.clone();
        let previous = self.by_path.insert(entry.path.clone(), entry);
        if let Some(old) = previous {
            self.refresh_duplicates(&old.id);
        }
        self.refresh_duplicates(&id);
    }

    /// Drop the entry at `path` and refresh the duplicate flags of its id.
    pub fn remove_path(&mut self, path: &str) -> Option<IndexEntry> {
        let removed = self.by_path.remove(path)?;
        self.refresh_duplicates(&removed.id);
        Some(removed)
    }

    /// Move the entry at `from` to `to`, keeping its id. False when `from` is absent.
    pub fn rename_path(&mut self, from: &str, to: &str) -> bool {
        let Some(mut entry) = self.by_path.remove(from) else {
            return false;
        };
        entry.path = to.to_owned();
        let id = entry.id.clone();
        let replaced = self.by_path.insert(to.to_owned(), entry);
        if let Some(old) = replaced {
            self.refresh_duplicates(&old.id);
        }
        self.refresh_duplicates(&id);
        true
    }

    /// The first entry (by path) with this id, duplicates included.
    #[must_use]
    pub fn get(&self, id: &str) -> Option<&IndexEntry> {
        self.by_path.values().find(|entry| entry.id == id)
    }

    /// The entry at this path.
    #[must_use]
    pub fn by_path(&self, path: &str) -> Option<&IndexEntry> {
        self.by_path.get(path)
    }

    /// Entries of one kind in one project. Kind `""` or `"*"` is every kind;
    /// `None` is every project.
    #[must_use]
    pub fn list(&self, kind: &str, project_id: Option<&str>) -> Vec<&IndexEntry> {
        let any_kind = kind.is_empty() || kind == "*";
        self.by_path
            .values()
            .filter(|entry| any_kind || entry.kind == kind)
            .filter(|entry| match project_id {
                None => true,
                Some(project) => entry.project_id.as_deref() == Some(project),
            })
            .collect()
    }

    /// Entries whose links contain `id`.
    #[must_use]
    pub fn backlinks(&self, id: &str) -> Vec<&IndexEntry> {
        self.by_path
            .values()
            .filter(|entry| entry.links.iter().any(|link| link == id))
            .collect()
    }

    /// How many entries carry each tag.
    #[must_use]
    pub fn tag_counts(&self) -> BTreeMap<String, usize> {
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        for tag in self.by_path.values().flat_map(|entry| entry.tags.iter()) {
            *counts.entry(tag.clone()).or_default() += 1;
        }
        counts
    }

    /// Replace one project's relations with `rows`.
    pub fn set_relations(&mut self, project_id: &str, rows: Vec<Relation>) {
        self.relations
            .retain(|(project, _)| project.as_str() != project_id);
        self.relations
            .extend(rows.into_iter().map(|row| (project_id.to_owned(), row)));
    }

    /// Relations where `id` is the source or the target.
    #[must_use]
    pub fn relations_of(&self, id: &str) -> Vec<&Relation> {
        self.relations
            .iter()
            .map(|(_, row)| row)
            .filter(|row| row.source_id == id || row.target_id == id)
            .collect()
    }

    /// Every entry whose id is shared by another live file.
    #[must_use]
    pub fn duplicates(&self) -> Vec<&IndexEntry> {
        self.by_path
            .values()
            .filter(|entry| entry.duplicate)
            .collect()
    }

    /// How many entries the index holds.
    #[must_use]
    pub fn len(&self) -> usize {
        self.by_path.len()
    }

    /// True when the index holds no entries.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.by_path.is_empty()
    }

    /// Recompute `duplicate` for every entry with this id. Conflict copies never count.
    fn refresh_duplicates(&mut self, id: &str) {
        if id.is_empty() {
            return;
        }
        let live = self
            .by_path
            .values()
            .filter(|entry| entry.id == id && entry.conflict_of.is_none())
            .count();
        for entry in self.by_path.values_mut().filter(|entry| entry.id == id) {
            entry.duplicate = live > 1 && entry.conflict_of.is_none();
        }
    }
}
