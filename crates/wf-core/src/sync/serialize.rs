//! Port of `packages/core/src/workspace/serialize-workspace.ts`: renders a workspace
//! snapshot to the (path, content) files the folder mirror holds.

use std::collections::HashSet;
use std::io;

use serde::Serialize;
use serde_json::ser::{Formatter, PrettyFormatter};
use serde_json::{Number, Value, json};

use crate::sync::frontmatter::js_number;

use crate::search::js_text::is_js_whitespace;
use crate::sync::blob_links::to_relative_blob_links;
use crate::sync::folder_layout::{
    FolderNode, WorkspaceEntityType, WorkspaceProject, flat_path, log_path, project_dir,
    project_meta_dir, tree_paths,
};
use crate::sync::frontmatter::write_frontmatter;
use crate::sync::ink_note::{is_ink_note_body, read_ink_note_body, write_ink_note_meta};
use crate::sync::json_entities::JsonRow;
use crate::sync::workspace_snapshot::{WorkspaceSnapshot, workspace_snapshot_counts};

/// Version stamped into `manifest.json`.
pub const WORKSPACE_SCHEMA_VERSION: u32 = 2;

/// An asset the mirror copies into `assets/`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SerializedAsset {
    /// The path after the app's blob scheme.
    pub storage_path: String,
    /// The `assets/<scope>/...` path written into the folder.
    pub folder_path: String,
}

/// A serialized workspace: its files in write order, and the assets they reference.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SerializedWorkspace {
    /// Every file as `(path, content)`, in write order.
    pub files: Vec<(String, String)>,
    /// Each referenced asset once, keyed by folder path, first occurrence kept.
    pub assets: Vec<SerializedAsset>,
}

/// Obsidian-safe tags: whitespace runs become `-`, duplicates dropped, first kept.
/// `None` when nothing is left, so the key is omitted rather than written empty.
#[must_use]
pub fn obsidian_tags(tags: &[String]) -> Option<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let slug = tag
            .split(is_js_whitespace)
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("-");
        if !slug.is_empty() && !out.contains(&slug) {
            out.push(slug);
        }
    }
    (!out.is_empty()).then_some(out)
}

/// Renders `snapshot` as the files of the project's folder mirror.
#[must_use]
pub fn serialize_workspace(
    snapshot: &WorkspaceSnapshot,
    project: &WorkspaceProject,
) -> SerializedWorkspace {
    let root = project_dir(project);
    let mut files = Vec::new();
    let mut assets = Vec::new();
    write_notes(&mut files, &mut assets, snapshot, &root);
    write_outline(&mut files, &mut assets, snapshot, &root);
    write_research(&mut files, &mut assets, snapshot, &root);
    write_meta(&mut files, snapshot, &root);
    put(
        &mut files,
        "README.md".to_owned(),
        readme(&snapshot.collected_at),
    );
    SerializedWorkspace {
        files,
        assets: unique_assets(assets),
    }
}

/// Writes `path`, replacing an earlier write to the same path in place.
fn put(files: &mut Vec<(String, String)>, path: String, content: String) {
    if let Some(entry) = files.iter_mut().find(|(p, _)| *p == path) {
        entry.1 = content;
    } else {
        files.push((path, content));
    }
}

fn field(key: &str, value: Value) -> (String, Value) {
    (key.to_owned(), value)
}

fn text(value: &str) -> Value {
    Value::String(value.to_owned())
}

fn opt_text(value: Option<&str>) -> Value {
    value.map_or(Value::Null, text)
}

fn num(value: Option<f64>) -> Value {
    value
        .and_then(Number::from_f64)
        .map_or(Value::Null, Value::Number)
}

fn list(items: &[String]) -> Value {
    Value::Array(items.iter().map(|item| text(item.as_str())).collect())
}

fn or_empty(value: Option<&str>) -> &str {
    value.unwrap_or("")
}

/// A `## heading` section, or nothing when the text is absent or empty.
fn section(heading: &str, body: Option<&str>) -> String {
    match body {
        Some(body) if !body.is_empty() => format!("## {heading}\n\n{body}"),
        _ => String::new(),
    }
}

/// Joins the non-empty parts with a blank line, as the TS `filter(Boolean).join`.
fn joined(parts: Vec<String>) -> String {
    parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// The path of `id` in a tree-path listing.
fn path_of<'a>(paths: &'a [(String, String)], id: &str) -> Option<&'a str> {
    paths
        .iter()
        .find(|(entry_id, _)| entry_id.as_str() == id)
        .map(|(_, path)| path.as_str())
}

/// The frontmatter alias for a non-empty string `title` field.
fn title_alias(fields: &[(String, Value)]) -> Option<(String, Value)> {
    fields
        .iter()
        .find(|(key, _)| key == "title")
        .and_then(|(_, value)| match value {
            Value::String(title) if !title.is_empty() => {
                Some(("aliases".to_owned(), Value::Array(vec![text(title)])))
            }
            _ => None,
        })
}

/// Renders one entity file: its blob refs made folder-relative, its assets collected.
fn markdown(
    path: &str,
    id: &str,
    entity: WorkspaceEntityType,
    fields: Vec<(String, Value)>,
    body: &str,
    assets: &mut Vec<SerializedAsset>,
) -> String {
    let links = to_relative_blob_links(body, path);
    assets.extend(links.assets.into_iter().map(|asset| SerializedAsset {
        storage_path: asset.storage_path,
        folder_path: asset.folder_path,
    }));
    let mut all = vec![
        field("weaveforge-id", text(id)),
        field("weaveforge-type", text(entity.as_str())),
    ];
    all.extend(fields);
    let alias = title_alias(&all);
    all.extend(alias);
    write_frontmatter(&all, &links.body)
}

fn write_entry(
    files: &mut Vec<(String, String)>,
    assets: &mut Vec<SerializedAsset>,
    path: String,
    id: &str,
    entity: WorkspaceEntityType,
    fields: Vec<(String, Value)>,
    body: &str,
) {
    let content = markdown(&path, id, entity, fields, body, assets);
    put(files, path, content);
}

fn write_notes(
    files: &mut Vec<(String, String)>,
    assets: &mut Vec<SerializedAsset>,
    snapshot: &WorkspaceSnapshot,
    root: &str,
) {
    let nodes: Vec<FolderNode> = snapshot
        .vault_pages
        .iter()
        .map(|page| FolderNode {
            id: page.id.clone(),
            title: page.title.clone(),
            parent_id: page.parent_id.clone(),
        })
        .collect();
    let paths = tree_paths(&nodes, WorkspaceEntityType::VaultPage, root);
    for page in &snapshot.vault_pages {
        let Some(path) = path_of(&paths, &page.id) else {
            continue;
        };
        let stamps = vec![
            field("title", text(&page.title)),
            field("updated-at", text(&page.updated_at)),
            field("created-at", text(&page.created_at)),
        ];
        if is_ink_note_body(&page.body) {
            let (meta, body) = read_ink_note_body(&page.body);
            let mut fields = stamps;
            fields.extend(write_ink_note_meta(&meta));
            let ink_path = ink_path_of(path);
            write_entry(
                files,
                assets,
                ink_path,
                &page.id,
                WorkspaceEntityType::InkPage,
                fields,
                &body,
            );
        } else {
            let entry_path = path.to_owned();
            write_entry(
                files,
                assets,
                entry_path,
                &page.id,
                WorkspaceEntityType::VaultPage,
                stamps,
                &page.body,
            );
        }
    }
}

/// `.note.md` at the end of a path becomes `.ink.md`; any other path is kept.
fn ink_path_of(path: &str) -> String {
    path.strip_suffix(".note.md")
        .map_or_else(|| path.to_owned(), |stem| format!("{stem}.ink.md"))
}

/// Reading lists and report sections, both nested by `parent_id`.
fn write_outline(
    files: &mut Vec<(String, String)>,
    assets: &mut Vec<SerializedAsset>,
    snapshot: &WorkspaceSnapshot,
    root: &str,
) {
    let lists: Vec<FolderNode> = snapshot
        .reading_lists
        .iter()
        .map(|list| FolderNode {
            id: list.id.clone(),
            title: list.name.clone(),
            parent_id: list.parent_id.clone(),
        })
        .collect();
    let list_paths = tree_paths(&lists, WorkspaceEntityType::ReadingList, root);
    for list in &snapshot.reading_lists {
        let Some(path) = path_of(&list_paths, &list.id) else {
            continue;
        };
        let fields = vec![
            field("title", text(&list.name)),
            field("color", opt_text(list.color.as_deref())),
            field("created-at", text(&list.created_at)),
        ];
        let body = or_empty(list.description.as_deref());
        write_entry(
            files,
            assets,
            path.to_owned(),
            &list.id,
            WorkspaceEntityType::ReadingList,
            fields,
            body,
        );
    }

    let sections: Vec<FolderNode> = snapshot
        .report_sections
        .iter()
        .map(|section| FolderNode {
            id: section.id.clone(),
            title: section.title.clone(),
            parent_id: section.parent_id.clone(),
        })
        .collect();
    let section_paths = tree_paths(&sections, WorkspaceEntityType::ReportSection, root);
    for item in &snapshot.report_sections {
        let Some(path) = path_of(&section_paths, &item.id) else {
            continue;
        };
        let fields = vec![
            field("title", text(&item.title)),
            field("section-no", opt_text(item.section_no.as_deref())),
            field("status", opt_text(item.status.as_deref())),
            field("target-words", num(item.target_words)),
            field("deadline", opt_text(item.deadline.as_deref())),
            field("created-at", text(&item.created_at)),
        ];
        let body = or_empty(item.notes.as_deref());
        write_entry(
            files,
            assets,
            path.to_owned(),
            &item.id,
            WorkspaceEntityType::ReportSection,
            fields,
            body,
        );
    }
}

/// Papers, experiments, milestones and log entries.
fn write_research(
    files: &mut Vec<(String, String)>,
    assets: &mut Vec<SerializedAsset>,
    snapshot: &WorkspaceSnapshot,
    root: &str,
) {
    write_papers(files, assets, snapshot, root);
    write_experiments(files, assets, snapshot, root);
    write_milestones_and_logs(files, assets, snapshot, root);
}

/// One file per paper.
fn write_papers(
    files: &mut Vec<(String, String)>,
    assets: &mut Vec<SerializedAsset>,
    snapshot: &WorkspaceSnapshot,
    root: &str,
) {
    for paper in &snapshot.papers {
        let path = flat_path(WorkspaceEntityType::Paper, &paper.id, &paper.title, root);
        let fields = vec![
            field("title", text(&paper.title)),
            field("authors", list(&paper.authors)),
            field("year", num(paper.year)),
            field("venue", opt_text(paper.venue.as_deref())),
            field("doi", opt_text(paper.doi.as_deref())),
            field("arxiv-id", opt_text(paper.arxiv_id.as_deref())),
            field("url", opt_text(paper.url.as_deref())),
            field("status", opt_text(paper.status.as_deref())),
            field("rating", num(paper.rating)),
            field(
                "tags",
                obsidian_tags(&paper.tags).map_or(Value::Null, |tags| list(&tags)),
            ),
            field("updated-at", text(&paper.updated_at)),
        ];
        let body = joined(vec![
            section("Abstract", paper.abstract_text.as_deref()),
            or_empty(paper.summary.as_deref()).to_owned(),
        ]);
        write_entry(
            files,
            assets,
            path,
            &paper.id,
            WorkspaceEntityType::Paper,
            fields,
            &body,
        );
    }
}

/// One file per experiment.
fn write_experiments(
    files: &mut Vec<(String, String)>,
    assets: &mut Vec<SerializedAsset>,
    snapshot: &WorkspaceSnapshot,
    root: &str,
) {
    for experiment in &snapshot.experiments {
        let path = flat_path(
            WorkspaceEntityType::Experiment,
            &experiment.id,
            &experiment.name,
            root,
        );
        let fields = vec![
            field("title", text(&experiment.name)),
            field("status", opt_text(experiment.status.as_deref())),
            field("repo-url", opt_text(experiment.repo_url.as_deref())),
            field("commit-sha", opt_text(experiment.commit_sha.as_deref())),
            field("branch", opt_text(experiment.branch.as_deref())),
            field("created-at", text(&experiment.created_at)),
        ];
        let body = joined(vec![
            section("Hypothesis", experiment.hypothesis.as_deref()),
            section("Result", experiment.result_note.as_deref()),
        ]);
        write_entry(
            files,
            assets,
            path,
            &experiment.id,
            WorkspaceEntityType::Experiment,
            fields,
            &body,
        );
    }
}

/// One file per milestone, and one per log entry.
fn write_milestones_and_logs(
    files: &mut Vec<(String, String)>,
    assets: &mut Vec<SerializedAsset>,
    snapshot: &WorkspaceSnapshot,
    root: &str,
) {
    for milestone in &snapshot.milestones {
        let path = flat_path(
            WorkspaceEntityType::Milestone,
            &milestone.id,
            &milestone.title,
            root,
        );
        let fields = vec![
            field("title", text(&milestone.title)),
            field("status", opt_text(milestone.status.as_deref())),
            field("target-date", opt_text(milestone.target_date.as_deref())),
            field("created-at", text(&milestone.created_at)),
        ];
        let body = or_empty(milestone.description.as_deref());
        write_entry(
            files,
            assets,
            path,
            &milestone.id,
            WorkspaceEntityType::Milestone,
            fields,
            body,
        );
    }

    for entry in &snapshot.log_entries {
        let path = log_path(&entry.id, &entry.entry_date, root);
        let fields = vec![
            field("entry-date", text(&entry.entry_date)),
            field("kind", text(&entry.kind)),
            field("created-at", text(&entry.created_at)),
        ];
        write_entry(
            files,
            assets,
            path,
            &entry.id,
            WorkspaceEntityType::LogEntry,
            fields,
            &entry.body,
        );
    }
}

fn rows(items: &[JsonRow]) -> Value {
    Value::Array(items.iter().cloned().map(Value::Object).collect())
}

/// Pretty JSON with a trailing newline, as the TS `stableJson`
/// (`JSON.stringify(value, null, 2)`): key order kept, numbers printed as JS prints them.
fn stable_json(value: &Value) -> String {
    let mut out = Vec::new();
    let mut ser =
        serde_json::Serializer::with_formatter(&mut out, JsPretty(PrettyFormatter::new()));
    if value.serialize(&mut ser).is_err() {
        return "\n".to_owned();
    }
    format!("{}\n", String::from_utf8(out).unwrap_or_default())
}

/// serde's pretty layout (two spaces, `": "`), but doubles in JS form:
/// `1` not `1.0`, `1e+21` not `1e21`.
struct JsPretty<'a>(PrettyFormatter<'a>);

impl Formatter for JsPretty<'_> {
    fn write_f64<W: ?Sized + io::Write>(&mut self, writer: &mut W, value: f64) -> io::Result<()> {
        writer.write_all(js_number(value).as_bytes())
    }
    fn begin_array<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.0.begin_array(writer)
    }
    fn end_array<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.0.end_array(writer)
    }
    fn begin_array_value<W: ?Sized + io::Write>(
        &mut self,
        writer: &mut W,
        first: bool,
    ) -> io::Result<()> {
        self.0.begin_array_value(writer, first)
    }
    fn end_array_value<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.0.end_array_value(writer)
    }
    fn begin_object<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.0.begin_object(writer)
    }
    fn end_object<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.0.end_object(writer)
    }
    fn begin_object_key<W: ?Sized + io::Write>(
        &mut self,
        writer: &mut W,
        first: bool,
    ) -> io::Result<()> {
        self.0.begin_object_key(writer, first)
    }
    fn begin_object_value<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.0.begin_object_value(writer)
    }
    fn end_object_value<W: ?Sized + io::Write>(&mut self, writer: &mut W) -> io::Result<()> {
        self.0.end_object_value(writer)
    }
}

/// The three data files and the manifest, under the project's `.weaveforge/`.
fn write_meta(files: &mut Vec<(String, String)>, snapshot: &WorkspaceSnapshot, root: &str) {
    let meta = project_meta_dir(root);
    put(
        files,
        format!("{meta}/relations.json"),
        stable_json(&rows(&snapshot.relations)),
    );
    put(
        files,
        format!("{meta}/tags.json"),
        stable_json(&rows(&snapshot.tags)),
    );
    put(
        files,
        format!("{meta}/reading-list-items.json"),
        stable_json(&rows(&snapshot.reading_list_items)),
    );
    let c = workspace_snapshot_counts(snapshot);
    let manifest = json!({
        "schemaVersion": WORKSPACE_SCHEMA_VERSION,
        "generatedAt": snapshot.collected_at.as_str(),
        "app": "WeaveForge",
        "counts": {
            "papers": c.papers,
            "notes": c.notes,
            "readingLists": c.reading_lists,
            "reportSections": c.report_sections,
            "experiments": c.experiments,
            "milestones": c.milestones,
            "logEntries": c.log_entries,
            "relations": c.relations,
            "tags": c.tags,
        },
    });
    put(
        files,
        format!("{meta}/manifest.json"),
        stable_json(&manifest),
    );
}

/// The top-level `README.md`, written as the TS lines joined with `\n`.
fn readme(collected_at: &str) -> String {
    let exported = format!("Exported {collected_at}.");
    [
        "# WeaveForge workspace",
        "",
        exported.as_str(),
        "",
        "Every file carries a `weaveforge-id` in its frontmatter. That id is what",
        "identifies the entity — renaming or moving a file is safe, and the id is",
        "how a re-import matches it back up. A file without one is treated as new.",
        "",
        "One folder per project, holding that project's own files:",
        "",
        "    <project>/notes/  papers/  report/  experiments/  plan/  logbook/",
        "    <project>/reading-lists/",
        "",
        "A project's folder is its name plus a short id (`msc-thesis--8d7317`), so two",
        "projects may share a name. A note with children becomes a folder holding a",
        "same-named file for its own text.",
        "",
        "Two things sit at the top of the folder because every project shares them:",
        "",
        "- `assets/` — images and figures a note or a paper refers to.",
        "- `.weaveforge/db` — the local database itself, and its backups.",
        "",
        "Each project keeps its own bookkeeping in `<project>/.weaveforge/`: the edges",
        "between its papers, their tags, reading-list membership, a summary of what is",
        "here, and the manifest the mirror writes so it can tell its own files from",
        "every other project's.",
        "",
    ]
    .join("\n")
}

/// Keeps the first asset per folder path, preserving order.
fn unique_assets(assets: Vec<SerializedAsset>) -> Vec<SerializedAsset> {
    let mut seen = HashSet::new();
    assets
        .into_iter()
        .filter(|asset| seen.insert(asset.folder_path.clone()))
        .collect()
}
