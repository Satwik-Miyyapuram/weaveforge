//! Reads workspace files into index entries, links and relations.
//! Pure: takes file text in, returns values; nothing is read from disk.

use serde_json::Value;

use super::store::{IndexEntry, IndexStore, Relation};
use crate::papers::paper_file::{PAPER_TYPE, parse_paper_file};
use crate::sync::deserialize::parse_workspace_file;
use crate::sync::frontmatter::{
    FileKind, canonical_digest, file_header, file_kind, frontmatter_list,
};

/// Build the index entry for one markdown or canvas file. None for other files
/// and for files with no id (a conflict copy without an id is still kept).
#[must_use]
pub fn entry_from_file(path: &str, text: &str) -> Option<IndexEntry> {
    let kind = file_kind(path);
    if !matches!(kind, FileKind::Markdown | FileKind::Canvas) {
        return None;
    }
    let header = file_header(path, text);
    let parsed = parse_workspace_file(path, text);
    let id = parsed
        .as_ref()
        .and_then(|found| found.id.clone())
        .or_else(|| header.id.clone());
    if id.is_none() && header.conflict_of.is_none() {
        return None;
    }
    let (kind_name, title, tags, links) = match parsed.as_ref() {
        Some(found) => (
            found
                .kind
                .clone()
                .unwrap_or_else(|| found.entity_type.as_str().to_owned()),
            found.title.clone(),
            unique(frontmatter_list(&found.fields, "tags")),
            wiki_links(&found.body),
        ),
        None => (
            fallback_kind(kind).to_owned(),
            file_stem(path),
            Vec::new(),
            wiki_links(text),
        ),
    };
    let id = id.unwrap_or_default();
    let relations = paper_relations(&kind_name, &id, text);
    Some(IndexEntry {
        id,
        path: path.to_owned(),
        kind: kind_name,
        project_id: project_of(path),
        title,
        tags,
        links,
        wf: header.wf,
        read_only: header.read_only,
        duplicate: false,
        conflict_of: header.conflict_of,
        digest: canonical_digest(text),
        relations,
    })
}

/// The outgoing relations a paper file declares in its frontmatter; none for other kinds.
fn paper_relations(kind: &str, id: &str, text: &str) -> Vec<Relation> {
    if kind != PAPER_TYPE {
        return Vec::new();
    }
    parse_paper_file(text)
        .map(|paper| paper.relations)
        .unwrap_or_default()
        .into_iter()
        .map(|row| Relation {
            source_id: id.to_owned(),
            target_id: row.to,
            relation_type: row.relation_type,
        })
        .collect()
}

/// The first path segment when the path has more than one segment and that
/// segment is not hidden (does not start with `.`).
#[must_use]
pub fn project_of(path: &str) -> Option<String> {
    let mut segments = path.split('/');
    let first = segments.next()?;
    let has_more = segments.next().is_some();
    (has_more && !first.is_empty() && !first.starts_with('.')).then(|| first.to_owned())
}

/// Ids from `[[id]]` and `[[id|label]]`, trimmed, deduplicated in first-seen order.
#[must_use]
pub fn wiki_links(body: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut rest = body;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else {
            break;
        };
        let target = after[..end].split('|').next().unwrap_or("").trim();
        if !target.is_empty() {
            targets.push(target.to_owned());
        }
        rest = &after[end + 2..];
    }
    unique(targets)
}

/// Relations from a `relations.json` body: a JSON array, or an object with a
/// `relations` array. Rows missing a source or target are skipped; bad JSON gives none.
#[must_use]
pub fn relations_from_json(text: &str) -> Vec<Relation> {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return Vec::new();
    };
    let rows: &[Value] = match &value {
        Value::Array(items) => items,
        Value::Object(map) => match map.get("relations") {
            Some(Value::Array(items)) => items,
            _ => &[],
        },
        _ => &[],
    };
    rows.iter().filter_map(relation_row).collect()
}

/// Index every markdown and canvas file in `files` (path, text pairs). Each
/// `<project>/.weaveforge/relations.json` replaces that project's relations.
#[must_use]
pub fn index_files<'a>(files: impl IntoIterator<Item = (&'a str, &'a str)>) -> IndexStore {
    let mut store = IndexStore::new();
    for (path, text) in files {
        if let Some(project) = relations_project(path) {
            store.set_relations(project, relations_from_json(text));
        } else if let Some(entry) = entry_from_file(path, text) {
            store.upsert(entry);
        }
    }
    store
}

/// The project a `<project>/.weaveforge/relations.json` path belongs to.
fn relations_project(path: &str) -> Option<&str> {
    let parts: Vec<&str> = path.split('/').collect();
    match parts.as_slice() {
        [project, ".weaveforge", "relations.json"] if !project.is_empty() => Some(*project),
        _ => None,
    }
}

/// One relation row, or None when source or target is missing.
fn relation_row(row: &Value) -> Option<Relation> {
    let object = row.as_object()?;
    let text = |key: &str| {
        object
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    let relation_type = text("relation_type")
        .or_else(|| text("type"))
        .unwrap_or_default();
    Some(Relation {
        source_id: text("source_id")?,
        target_id: text("target_id")?,
        relation_type,
    })
}

/// Drop repeats, keeping first-seen order.
fn unique(items: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for item in items {
        if !out.contains(&item) {
            out.push(item);
        }
    }
    out
}

/// Kind name used when the parser gives no entity for a file.
const fn fallback_kind(kind: FileKind) -> &'static str {
    match kind {
        FileKind::Canvas => "canvas",
        _ => "markdown",
    }
}

/// The file name without its last extension.
fn file_stem(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.')
        .map_or(name, |(stem, _)| stem)
        .to_owned()
}
