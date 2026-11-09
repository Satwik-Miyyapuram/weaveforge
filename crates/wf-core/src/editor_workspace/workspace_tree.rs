//! The explorer's tree, derived from entities that are already loaded.
//!
//! Port of `apps/web/src/features/editor-workspace/application/workspace-tree.ts`.
//!
//! There is no separate "file" model here. A folder path is computed from titles
//! and parents, so the tree carries `{kind, id}` and the path only as the label
//! the user sees. A rename therefore moves no file and open tabs need no fixing.
//!
//! Four roots (notes, papers, report, logbook), then one Overleaf leaf. Reading
//! lists are a separate tree, built by [`build_lists_tree`].

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::js_collate::locale_compare;
use crate::search::js_text::is_letter_or_number;
use crate::sync::folder_layout::{
    FolderNode, WorkspaceEntityType, entity_dir, entity_dir_name, flat_path, kind_suffix, log_path,
    tree_paths,
};

/// What a tree row is: an entity kind, or one of the tree's own rows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum TreeNodeKind {
    /// A note.
    VaultPage,
    /// An ink note.
    InkPage,
    /// A paper.
    Paper,
    /// A reading list.
    ReadingList,
    /// A report section.
    ReportSection,
    /// An experiment.
    Experiment,
    /// A milestone.
    Milestone,
    /// A log entry.
    LogEntry,
    /// A grouping row, which is not a document.
    Folder,
    /// A paper's PDF.
    PaperPdf,
    /// An Overleaf project.
    Overleaf,
}

impl From<WorkspaceEntityType> for TreeNodeKind {
    fn from(entity: WorkspaceEntityType) -> Self {
        match entity {
            WorkspaceEntityType::VaultPage => Self::VaultPage,
            WorkspaceEntityType::InkPage => Self::InkPage,
            WorkspaceEntityType::Paper => Self::Paper,
            WorkspaceEntityType::ReadingList => Self::ReadingList,
            WorkspaceEntityType::ReportSection => Self::ReportSection,
            WorkspaceEntityType::Experiment => Self::Experiment,
            WorkspaceEntityType::Milestone => Self::Milestone,
            WorkspaceEntityType::LogEntry => Self::LogEntry,
        }
    }
}

/// One row of the explorer tree.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTreeNode {
    /// Stable across renames: `kind:id` for entities, the directory name for roots.
    pub key: String,
    /// What the row is.
    pub kind: TreeNodeKind,
    /// The entity's id. Absent on a grouping row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// The text the user sees.
    pub label: String,
    /// The entity's title, where the label is not it (a paper's two files).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The mirrored path: a tooltip, and what quick open matches.
    pub path: String,
    /// Child rows, in display order.
    #[serde(default)]
    pub children: Vec<WorkspaceTreeNode>,
    /// A paper with no note yet. It is still listed, so the explorer can offer to start one.
    #[serde(default, skip_serializing_if = "is_false")]
    pub missing_note: bool,
    /// A row inside Reading lists: the same document seen through a list.
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_member: bool,
    /// Inherited from a parent list.
    #[serde(default, skip_serializing_if = "is_false")]
    pub inherited: bool,
    /// The label of the list an inherited row came from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inherited_from: Option<String>,
    /// An Outline heading level. Not produced here; kept so the row shape matches the TypeScript type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heading_level: Option<u32>,
    /// A note made as a folder: it holds notes and folders and opens nothing.
    #[serde(default, skip_serializing_if = "is_false")]
    pub folder: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

impl WorkspaceTreeNode {
    fn new(key: String, kind: TreeNodeKind, label: String, path: String) -> Self {
        Self {
            key,
            kind,
            id: None,
            label,
            title: None,
            path,
            children: Vec::new(),
            missing_note: false,
            is_member: false,
            inherited: false,
            inherited_from: None,
            heading_level: None,
            folder: false,
        }
    }
}

/// A paper as the tree needs it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PaperEntry {
    /// Paper id.
    pub id: String,
    /// Paper title.
    pub title: String,
    /// Whether the paper already has a note.
    pub has_note: bool,
}

/// A note in the notes tree, with the kind its body claims.
///
/// An ink note sits among the notes: same folder, same parent chain. Only its
/// row and its suffix differ.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NoteNode {
    /// Note id.
    pub id: String,
    /// Note title.
    pub title: String,
    /// Parent note id. Empty or absent means the root.
    #[serde(default)]
    pub parent_id: Option<String>,
    /// `vault_page` or `ink_page`. Absent means a plain note.
    #[serde(default)]
    pub kind: Option<WorkspaceEntityType>,
    /// Whether the note is a folder.
    #[serde(default)]
    pub folder: bool,
}

/// A report section in the report tree.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SectionNode {
    /// Section id.
    pub id: String,
    /// Section title.
    pub title: String,
    /// Parent section id. Empty or absent means the root.
    #[serde(default)]
    pub parent_id: Option<String>,
}

/// A log entry. The row's label is its date, so there is no second field to disagree with it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLogEntry {
    /// Entry id.
    pub id: String,
    /// The entry's date, `YYYY-MM-DD`.
    pub entry_date: String,
}

/// An Overleaf project the sidebar lists.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OverleafProject {
    /// Project id.
    pub id: String,
    /// Project name.
    pub name: String,
}

/// Everything the workspace tree is built from.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase", default)]
pub struct WorkspaceTreeInput {
    /// The project's folder, which every path in the tree is inside. Empty is the flat layout.
    pub project_root: String,
    /// Notes, in any order.
    pub notes: Vec<NoteNode>,
    /// Papers, in any order.
    pub papers: Vec<PaperEntry>,
    /// Report sections, in any order.
    pub report_sections: Vec<SectionNode>,
    /// Logbook entries, in any order.
    pub log_entries: Vec<WorkspaceLogEntry>,
    /// Overleaf projects, one row each.
    pub overleaf_projects: Vec<OverleafProject>,
}

/// A visible row of the explorer, with its indent.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct VisibleRow {
    /// The row.
    pub node: WorkspaceTreeNode,
    /// How deep the row sits. Roots are 0.
    pub depth: usize,
}

/// The rows a filter leaves, and the keys that must be open to show them.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FilteredRows {
    /// The rows to paint, in order.
    pub rows: Vec<VisibleRow>,
    /// Keys the caller merges into its expansion set.
    pub expand: HashSet<String>,
}

/// Which kind of item a reading-list membership refers to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
pub enum ListItemKind {
    /// A paper.
    Paper,
    /// A vault page (a note).
    VaultPage,
}

impl ListItemKind {
    /// The wire string, as the TypeScript kind is written.
    const fn as_str(self) -> &'static str {
        match self {
            Self::Paper => "paper",
            Self::VaultPage => "vault_page",
        }
    }

    /// The entity this membership points at.
    const fn entity(self) -> WorkspaceEntityType {
        match self {
            Self::Paper => WorkspaceEntityType::Paper,
            Self::VaultPage => WorkspaceEntityType::VaultPage,
        }
    }
}

/// A reading list as the tree needs it. Ids and parents, nothing else.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ListEntry {
    /// List id.
    pub id: String,
    /// List title.
    pub title: String,
    /// Parent list id. Empty or absent means a top-level list.
    #[serde(default)]
    pub parent_id: Option<String>,
    /// The list's slug, when the caller already computed it.
    #[serde(default)]
    pub slug: Option<String>,
    /// The parent's slug, when the caller already computed it.
    #[serde(default)]
    pub parent_slug: Option<String>,
}

/// One membership row: a paper or a vault page in a list.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ListItemEntry {
    /// The list this membership belongs to.
    pub list_id: String,
    /// The entity kind.
    pub kind: ListItemKind,
    /// The entity id.
    pub id: String,
    /// Overrides the entity's own title when the membership renamed it.
    #[serde(default)]
    pub label: Option<String>,
    /// The list this membership was inherited from.
    #[serde(default)]
    pub inherited_from_list_id: Option<String>,
    /// Set on a duplicate, which the explorer does not show.
    #[serde(default)]
    pub duplicate_of_item_id: Option<String>,
}

/// Everything the reading-lists tree is built from.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase", default)]
pub struct ListsTreeInput {
    /// The lists, in any order.
    pub lists: Vec<ListEntry>,
    /// The memberships, in any order.
    pub items: Vec<ListItemEntry>,
    /// Titles for member rows, keyed `kind:id`. A row with no entry falls back to its id.
    pub titles: HashMap<String, String>,
    /// Display rank per member kind (`paper`, `vault_page`), lower first. Passed in as data
    /// because the presentation order lives in the UI's kind table. Absent means no ranking.
    pub member_rank: Option<HashMap<String, i64>>,
}

/// Compare labels the way `localeCompare(b, undefined, { numeric: true, sensitivity: "base" })` does.
fn by_label(a: &WorkspaceTreeNode, b: &WorkspaceTreeNode) -> Ordering {
    numeric_collate(&a.label, &b.label)
}

/// Numeric-aware, case-blind comparison. Digit runs compare by value; text runs
/// compare with `locale_compare` on their lower-cased form.
///
/// Approximation: accents still break ties, where ICU's base sensitivity would
/// call them equal.
fn numeric_collate(a: &str, b: &str) -> Ordering {
    let mut left = tokens(a).into_iter();
    let mut right = tokens(b).into_iter();
    loop {
        match (left.next(), right.next()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some((x_digits, x)), Some((y_digits, y))) => {
                let ord = if x_digits && y_digits {
                    compare_numbers(&x, &y)
                } else {
                    locale_compare(&x, &y)
                };
                if ord != Ordering::Equal {
                    return ord;
                }
            }
        }
    }
}

/// Split into runs of ASCII digits (`true`) and everything else (`false`).
fn tokens(text: &str) -> Vec<(bool, String)> {
    let mut out: Vec<(bool, String)> = Vec::new();
    for ch in text.chars() {
        let digit = ch.is_ascii_digit();
        let piece: String = if digit {
            ch.to_string()
        } else {
            ch.to_lowercase().collect()
        };
        match out.last_mut() {
            Some((last_digit, last)) if *last_digit == digit => last.push_str(&piece),
            _ => out.push((digit, piece)),
        }
    }
    out
}

/// Compare two digit runs by value, without overflow.
fn compare_numbers(x: &str, y: &str) -> Ordering {
    let x = x.trim_start_matches('0');
    let y = y.trim_start_matches('0');
    x.len().cmp(&y.len()).then_with(|| x.cmp(y))
}

/// Attach each node to its parent, returning `(children per node, root indices)`.
///
/// A node whose parent is missing, or whose parent chain loops back to it, stays
/// at the root rather than vanishing with its subtree.
fn attach<'a>(ids: &[&'a str], parents: &[Option<&'a str>]) -> (Vec<Vec<usize>>, Vec<usize>) {
    let index: HashMap<&str, usize> = ids.iter().enumerate().map(|(at, id)| (*id, at)).collect();
    let parent_map: HashMap<&str, Option<&str>> =
        ids.iter().copied().zip(parents.iter().copied()).collect();
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); ids.len()];
    let mut roots: Vec<usize> = Vec::new();
    for (at, &id) in ids.iter().enumerate() {
        let looped = on_parent_loop(id, |probe| parent_map.get(probe).copied().flatten());
        let parent = parents
            .get(at)
            .copied()
            .flatten()
            .filter(|p| !p.is_empty())
            .filter(|_| !looped)
            .and_then(|p| index.get(p).copied());
        match parent {
            Some(p) => children[p].push(at),
            None => roots.push(at),
        }
    }
    (children, roots)
}

/// True when following parents up from `id` comes back to `id`: a corrupt loop.
fn on_parent_loop<'a>(id: &str, parent_of: impl Fn(&str) -> Option<&'a str>) -> bool {
    let mut seen: HashSet<&'a str> = HashSet::new();
    let mut at = parent_of(id);
    while let Some(current) = at {
        if current.is_empty() || seen.contains(current) {
            break;
        }
        if current == id {
            return true;
        }
        seen.insert(current);
        at = parent_of(current);
    }
    false
}

/// Build the subtree for each index, sorted by label, with `tail` rows appended after the sorted children.
fn materialize_all(
    indices: &[usize],
    base: &[WorkspaceTreeNode],
    children: &[Vec<usize>],
    tail: Option<&[Vec<WorkspaceTreeNode>]>,
) -> Vec<WorkspaceTreeNode> {
    let mut out: Vec<WorkspaceTreeNode> = indices
        .iter()
        .map(|&at| materialize(at, base, children, tail))
        .collect();
    out.sort_by(by_label);
    out
}

fn materialize(
    at: usize,
    base: &[WorkspaceTreeNode],
    children: &[Vec<usize>],
    tail: Option<&[Vec<WorkspaceTreeNode>]>,
) -> WorkspaceTreeNode {
    let mut node = base[at].clone();
    node.children = materialize_all(&children[at], base, children, tail);
    if let Some(rows) = tail.and_then(|extra| extra.get(at)) {
        node.children.extend(rows.iter().cloned());
    }
    node
}

/// One node as the nesting sees it, from notes or report sections.
struct Row<'a> {
    id: &'a str,
    title: &'a str,
    parent_id: Option<&'a str>,
    kind: Option<WorkspaceEntityType>,
    folder: bool,
}

/// Build one root by nesting rows under their parents, with paths from `tree_paths`.
fn nested_root(
    label: &str,
    entity: WorkspaceEntityType,
    rows: &[Row<'_>],
    project_root: &str,
) -> WorkspaceTreeNode {
    let folder_nodes: Vec<FolderNode> = rows
        .iter()
        .map(|row| FolderNode {
            id: row.id.to_string(),
            title: row.title.to_string(),
            parent_id: row.parent_id.map(str::to_string),
        })
        .collect();
    let paths: HashMap<String, String> = tree_paths(&folder_nodes, entity, project_root)
        .into_iter()
        .collect();
    let fallback = entity_dir(entity, project_root);

    let base: Vec<WorkspaceTreeNode> = rows
        .iter()
        .map(|row| {
            let kind = row.kind.unwrap_or(entity);
            let path = paths
                .get(row.id)
                .cloned()
                .unwrap_or_else(|| fallback.clone());
            // An ink note mirrors as `.ink.md` in the place a note would be.
            let path = if kind == entity {
                path
            } else {
                with_kind_suffix(&path, kind_suffix(kind))
            };
            let mut node = WorkspaceTreeNode::new(
                format!("{}:{}", kind.as_str(), row.id),
                TreeNodeKind::from(kind),
                trimmed_or(row.title, "Untitled"),
                path,
            );
            node.id = Some(row.id.to_string());
            node.folder = row.folder;
            node
        })
        .collect();

    let ids: Vec<&str> = rows.iter().map(|row| row.id).collect();
    let parents: Vec<Option<&str>> = rows.iter().map(|row| row.parent_id).collect();
    let (children, roots) = attach(&ids, &parents);

    let mut root = WorkspaceTreeNode::new(
        entity_dir_name(entity).to_string(),
        TreeNodeKind::Folder,
        label.to_string(),
        entity_dir(entity, project_root),
    );
    root.children = materialize_all(&roots, &base, &children, None);
    root
}

/// Replace a trailing `.<letters>.md` with `.<suffix>.md`, as the TypeScript regex does.
fn with_kind_suffix(path: &str, suffix: &str) -> String {
    let Some(stem) = path.strip_suffix(".md") else {
        return path.to_string();
    };
    let Some(dot) = stem.rfind('.') else {
        return path.to_string();
    };
    let current = &stem[dot + 1..];
    let letters_only =
        !current.is_empty() && current.chars().all(|c| c.is_ascii_lowercase() || c == '_');
    if letters_only {
        format!("{}.{suffix}.md", &stem[..dot])
    } else {
        path.to_string()
    }
}

fn trimmed_or(text: &str, fallback: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn nonblank(text: Option<&str>) -> Option<String> {
    text.map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
}

fn present(value: &Option<String>) -> bool {
    value.as_deref().is_some_and(|v| !v.is_empty())
}

/// Build the explorer's workspace tree: Notes, Papers, Report, Log, Overleaf.
#[must_use]
pub fn build_workspace_tree(input: &WorkspaceTreeInput) -> Vec<WorkspaceTreeNode> {
    let root = input.project_root.as_str();

    let mut papers: Vec<WorkspaceTreeNode> = input
        .papers
        .iter()
        .map(|paper| paper_row(paper, root))
        .collect();
    papers.sort_by(by_label);

    let mut log: Vec<WorkspaceTreeNode> = input
        .log_entries
        .iter()
        .map(|entry| {
            let mut node = WorkspaceTreeNode::new(
                format!("log_entry:{}", entry.id),
                TreeNodeKind::LogEntry,
                entry.entry_date.clone(),
                log_path(&entry.id, &entry.entry_date, root),
            );
            node.id = Some(entry.id.clone());
            node
        })
        .collect();
    // Newest first. The date is the label, so the label is the sort key.
    log.sort_by(|a, b| locale_compare(&b.label, &a.label));

    let note_rows: Vec<Row<'_>> = input
        .notes
        .iter()
        .map(|note| Row {
            id: note.id.as_str(),
            title: note.title.as_str(),
            parent_id: note.parent_id.as_deref(),
            kind: note.kind,
            folder: note.folder,
        })
        .collect();
    let section_rows: Vec<Row<'_>> = input
        .report_sections
        .iter()
        .map(|section| Row {
            id: section.id.as_str(),
            title: section.title.as_str(),
            parent_id: section.parent_id.as_deref(),
            kind: None,
            folder: false,
        })
        .collect();

    let mut papers_root = WorkspaceTreeNode::new(
        entity_dir_name(WorkspaceEntityType::Paper).to_string(),
        TreeNodeKind::Folder,
        "Papers".to_string(),
        entity_dir(WorkspaceEntityType::Paper, root),
    );
    papers_root.children = papers;

    let mut log_root = WorkspaceTreeNode::new(
        entity_dir_name(WorkspaceEntityType::LogEntry).to_string(),
        TreeNodeKind::Folder,
        "Log".to_string(),
        entity_dir(WorkspaceEntityType::LogEntry, root),
    );
    log_root.children = log;

    // Overleaf projects: one row each. A row opens that project's editor in a tab.
    let mut overleaf = WorkspaceTreeNode::new(
        "overleaf".to_string(),
        TreeNodeKind::Folder,
        "Overleaf".to_string(),
        "overleaf".to_string(),
    );
    overleaf.children = input
        .overleaf_projects
        .iter()
        .map(|project| {
            let mut node = WorkspaceTreeNode::new(
                format!("overleaf:{}", project.id),
                TreeNodeKind::Overleaf,
                project.name.clone(),
                format!("overleaf/{}", project.name),
            );
            node.id = Some(project.id.clone());
            node
        })
        .collect();

    vec![
        nested_root("Notes", WorkspaceEntityType::VaultPage, &note_rows, root),
        papers_root,
        nested_root("Report", WorkspaceEntityType::ReportSection, &section_rows, root),
        log_root,
        overleaf,
    ]
}

/// A paper is two files under one grouping row: its PDF, then its notes.
fn paper_row(paper: &PaperEntry, root: &str) -> WorkspaceTreeNode {
    let label = trimmed_or(&paper.title, "Untitled");
    let notes_path = flat_path(WorkspaceEntityType::Paper, &paper.id, &paper.title, root);
    let base = notes_path
        .strip_suffix(".paper.md")
        .unwrap_or(notes_path.as_str())
        .to_string();

    let mut pdf = WorkspaceTreeNode::new(
        format!("paper_pdf:{}", paper.id),
        TreeNodeKind::PaperPdf,
        "PDF".to_string(),
        format!("{base}.pdf"),
    );
    pdf.id = Some(paper.id.clone());
    pdf.title = Some(label.clone());

    let mut notes = WorkspaceTreeNode::new(
        format!("paper:{}", paper.id),
        TreeNodeKind::Paper,
        "Notes".to_string(),
        notes_path,
    );
    notes.id = Some(paper.id.clone());
    notes.title = Some(label.clone());
    notes.missing_note = !paper.has_note;

    let mut row = WorkspaceTreeNode::new(
        format!("papers/{}", paper.id),
        TreeNodeKind::Folder,
        label,
        base,
    );
    row.children = vec![pdf, notes];
    row
}

/// Every document node, depth-first, leaving out grouping rows and member rows.
/// This is what quick open searches over.
#[must_use]
pub fn flatten_tree(nodes: &[WorkspaceTreeNode]) -> Vec<WorkspaceTreeNode> {
    let mut out: Vec<WorkspaceTreeNode> = Vec::new();
    for node in nodes {
        collect_documents(node, &mut out);
    }
    out
}

fn collect_documents(node: &WorkspaceTreeNode, out: &mut Vec<WorkspaceTreeNode>) {
    // A member row is the same document as the row under Files, so it is not indexed twice.
    if is_document_node(node) && !node.is_member {
        out.push(node.clone());
    }
    for child in &node.children {
        collect_documents(child, out);
    }
}

/// Whether a node is a document rather than a grouping row.
#[must_use]
pub fn is_document_node(node: &WorkspaceTreeNode) -> bool {
    node.kind != TreeNodeKind::Folder && !node.folder
}

/// The ids of the notes made as folders: the only notes a new note may go into.
#[must_use]
pub fn folder_ids_of(nodes: &[WorkspaceTreeNode]) -> HashSet<String> {
    let mut out: HashSet<String> = HashSet::new();
    for node in nodes {
        collect_folder_ids(node, &mut out);
    }
    out
}

fn collect_folder_ids(node: &WorkspaceTreeNode, out: &mut HashSet<String>) {
    if node.folder {
        if let Some(id) = node.id.as_deref().filter(|id| !id.is_empty()) {
            out.insert(id.to_string());
        }
    }
    for child in &node.children {
        collect_folder_ids(child, out);
    }
}

/// The rows the explorer paints, flattened with their indent. A row's children
/// appear only when its key is in `expanded`.
#[must_use]
pub fn visible_rows(nodes: &[WorkspaceTreeNode], expanded: &HashSet<String>) -> Vec<VisibleRow> {
    let mut out: Vec<VisibleRow> = Vec::new();
    for node in nodes {
        walk_visible(node, 0, expanded, &mut out);
    }
    out
}

fn walk_visible(
    node: &WorkspaceTreeNode,
    depth: usize,
    expanded: &HashSet<String>,
    out: &mut Vec<VisibleRow>,
) {
    out.push(VisibleRow {
        node: node.clone(),
        depth,
    });
    if !expanded.contains(node.key.as_str()) {
        return;
    }
    for child in &node.children {
        walk_visible(child, depth + 1, expanded, out);
    }
}

/// The slug a title becomes in a mirrored path. The same rule everywhere.
#[must_use]
pub fn slug_segment(title: &str) -> String {
    let slug = dashed(title);
    if slug.is_empty() {
        "list".to_string()
    } else {
        slug
    }
}

/// Lower-case, runs of non-letter/number become `-`, dashes trimmed from the ends.
fn dashed(text: &str) -> String {
    let lowered = text.trim().to_lowercase();
    let mut out = String::new();
    let mut in_gap = false;
    for ch in lowered.chars() {
        if is_letter_or_number(ch) {
            out.push(ch);
            in_gap = false;
        } else if !in_gap {
            out.push('-');
            in_gap = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// The path a list file is mirrored to: `reading-lists/<parent>/<slug>.list.md`.
#[must_use]
pub fn list_path(list: &ListEntry) -> String {
    let slug = list
        .slug
        .clone()
        .unwrap_or_else(|| slug_segment(&list.title));
    list_path_parts(&slug, list.parent_slug.as_deref())
}

fn list_path_parts(slug: &str, parent_slug: Option<&str>) -> String {
    match parent_slug.filter(|parent| !parent.is_empty()) {
        Some(parent) => format!("reading-lists/{parent}/{slug}.list.md"),
        None => format!("reading-lists/{slug}.list.md"),
    }
}

/// A nested list's parent slug: the caller's if it sent one, else derived from the parent's title.
fn list_parent_slug(list: &ListEntry, titled: &HashMap<&str, &str>) -> Option<String> {
    let parent = list.parent_id.as_deref().filter(|p| !p.is_empty())?;
    Some(
        list.parent_slug
            .clone()
            .unwrap_or_else(|| slug_segment(titled.get(parent).copied().unwrap_or(""))),
    )
}

/// Build the Reading lists section. Its roots are the lists themselves (no folder row above them).
///
/// A list's children are its nested lists, sorted by label, followed by its
/// members, ranked by `member_rank` and then sorted by label.
#[must_use]
pub fn build_lists_tree(input: &ListsTreeInput) -> Vec<WorkspaceTreeNode> {
    let titled: HashMap<&str, &str> = input
        .lists
        .iter()
        .map(|list| (list.id.as_str(), list.title.as_str()))
        .collect();

    let base: Vec<WorkspaceTreeNode> = input
        .lists
        .iter()
        .map(|list| {
            let slug = list
                .slug
                .clone()
                .unwrap_or_else(|| slug_segment(&list.title));
            let path = list_path_parts(&slug, list_parent_slug(list, &titled).as_deref());
            let mut node = WorkspaceTreeNode::new(
                format!("reading_list:{}", list.id),
                TreeNodeKind::ReadingList,
                trimmed_or(&list.title, "Untitled list"),
                path,
            );
            node.id = Some(list.id.clone());
            node
        })
        .collect();

    let index: HashMap<&str, usize> = input
        .lists
        .iter()
        .enumerate()
        .map(|(at, list)| (list.id.as_str(), at))
        .collect();
    let ids: Vec<&str> = input.lists.iter().map(|list| list.id.as_str()).collect();
    let parents: Vec<Option<&str>> = input
        .lists
        .iter()
        .map(|list| list.parent_id.as_deref())
        .collect();
    let (children, roots) = attach(&ids, &parents);

    let members = member_rows(input, &index, &base);
    materialize_all(&roots, &base, &children, Some(members.as_slice()))
}

/// Member rows for each list, already ranked and sorted, indexed by list position.
fn member_rows(
    input: &ListsTreeInput,
    index: &HashMap<&str, usize>,
    base: &[WorkspaceTreeNode],
) -> Vec<Vec<WorkspaceTreeNode>> {
    let mut ranked: Vec<Vec<(i64, WorkspaceTreeNode)>> = vec![Vec::new(); input.lists.len()];
    for item in &input.items {
        // A duplicate is the screening screen's business, not the tree's.
        if present(&item.duplicate_of_item_id) {
            continue;
        }
        let Some(&at) = index.get(item.list_id.as_str()) else {
            continue;
        };
        let entity_key = format!("{}:{}", item.kind.as_str(), item.id);
        let label = nonblank(item.label.as_deref())
            .or_else(|| nonblank(input.titles.get(&entity_key).map(String::as_str)))
            .unwrap_or_else(|| item.id.clone());

        let mut row = WorkspaceTreeNode::new(
            format!("reading_list:{}/{entity_key}", item.list_id),
            TreeNodeKind::from(item.kind.entity()),
            label.clone(),
            member_path(item.kind, &item.id, &label),
        );
        row.id = Some(item.id.clone());
        row.is_member = true;
        if let Some(from) = item
            .inherited_from_list_id
            .as_deref()
            .filter(|f| !f.is_empty())
        {
            row.inherited = true;
            row.inherited_from = Some(
                index
                    .get(from)
                    .and_then(|&list_at| base.get(list_at))
                    .map_or_else(|| from.to_string(), |list| list.label.clone()),
            );
        }
        let rank = rank_of(input.member_rank.as_ref(), item.kind.as_str());
        ranked[at].push((rank, row));
    }

    ranked
        .into_iter()
        .map(|mut rows| {
            rows.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| by_label(&a.1, &b.1)));
            rows.into_iter().map(|(_, row)| row).collect()
        })
        .collect()
}

/// A kind's display rank. With no table, every kind ranks equal. An unknown kind ranks last.
fn rank_of(table: Option<&HashMap<String, i64>>, kind: &str) -> i64 {
    match table {
        Some(table) => table.get(kind).copied().unwrap_or(i64::MAX),
        None => 0,
    }
}

/// A member's path: its own file, not the list's. `papers/<slug>--<id6>.md` and so on.
fn member_path(kind: ListItemKind, id: &str, label: &str) -> String {
    format!(
        "{}/{}--{}.md",
        entity_dir_name(kind.entity()),
        slugish(label),
        utf16_prefix(id, 6),
    )
}

fn slugish(text: &str) -> String {
    let slug = dashed(text);
    let cut = utf16_prefix(&slug, 48);
    if cut.is_empty() {
        "untitled".to_string()
    } else {
        cut.to_string()
    }
}

/// The longest prefix of `text` that is at most `max` UTF-16 units long.
fn utf16_prefix(text: &str, max: usize) -> &str {
    let mut used = 0;
    for (at, ch) in text.char_indices() {
        used += ch.len_utf16();
        if used > max {
            return &text[..at];
        }
    }
    text
}

/// Which lists each document belongs to, keyed `kind:id`, for the "N lists" hint on a Files row.
#[must_use]
pub fn list_membership(
    items: &[ListItemEntry],
    titles: &HashMap<String, String>,
) -> BTreeMap<String, Vec<String>> {
    let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for item in items {
        if present(&item.duplicate_of_item_id) {
            continue;
        }
        let entity_key = format!("{}:{}", item.kind.as_str(), item.id);
        let list_key = format!("reading_list:{}", item.list_id);
        let list_title = titles
            .get(&list_key)
            .cloned()
            .unwrap_or_else(|| item.list_id.clone());
        out.entry(entity_key).or_default().push(list_title);
    }
    out
}

/// The rows a filter leaves, and the keys that must be open to show them.
///
/// A match opens its own subtree, and everything indented under a kept row is
/// kept too. An empty query returns the rows untouched and opens nothing.
#[must_use]
pub fn filter_rows(rows: &[VisibleRow], query: &str) -> FilteredRows {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return FilteredRows {
            rows: rows.to_vec(),
            expand: HashSet::new(),
        };
    }

    let matched: Vec<bool> = rows
        .iter()
        .map(|row| {
            format!("{}\n{}", row.node.label, row.node.path)
                .to_lowercase()
                .contains(&needle)
        })
        .collect();

    let mut keep = vec![false; rows.len()];
    let mut expand: HashSet<String> = HashSet::new();
    // Depth of the kept branch a row may sit inside, if any.
    let mut branch: Option<usize> = None;
    for (index, row) in rows.iter().enumerate() {
        let matched_here = matched[index];
        let inside_branch = branch.is_some_and(|depth| row.depth > depth);
        if !matched_here && inside_branch {
            keep[index] = true;
            continue;
        }
        if !matched_here {
            branch = None;
            continue;
        }
        keep[index] = true;
        expand.insert(row.node.key.clone());
        // Walk up to every ancestor, keeping and opening each one.
        let mut depth = row.depth;
        let mut at = index;
        while at > 0 && depth > 0 {
            at -= 1;
            if rows[at].depth < depth {
                keep[at] = true;
                expand.insert(rows[at].node.key.clone());
                depth = rows[at].depth;
            }
        }
        branch = Some(row.depth);
    }

    let kept: Vec<VisibleRow> = rows
        .iter()
        .enumerate()
        .filter(|(index, _)| keep[*index])
        .map(|(_, row)| row.clone())
        .collect();
    FilteredRows {
        rows: kept,
        expand,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    fn note(id: &str, title: &str, parent: Option<&str>) -> NoteNode {
        NoteNode {
            id: id.into(),
            title: title.into(),
            parent_id: parent.map(str::to_string),
            kind: None,
            folder: false,
        }
    }

    fn paper(id: &str, title: &str, has_note: bool) -> PaperEntry {
        PaperEntry {
            id: id.into(),
            title: title.into(),
            has_note,
        }
    }

    fn every_node(nodes: &[WorkspaceTreeNode]) -> Vec<WorkspaceTreeNode> {
        nodes
            .iter()
            .flat_map(|node| {
                let mut out = vec![node.clone()];
                out.extend(every_node(&node.children));
                out
            })
            .collect()
    }

    fn labels(nodes: &[WorkspaceTreeNode]) -> Vec<String> {
        nodes.iter().map(|node| node.label.clone()).collect()
    }

    fn ids(nodes: &[WorkspaceTreeNode]) -> Vec<String> {
        nodes
            .iter()
            .map(|node| node.id.clone().unwrap_or_default())
            .collect()
    }

    fn list(id: &str, title: &str, parent: Option<&str>) -> ListEntry {
        ListEntry {
            id: id.into(),
            title: title.into(),
            parent_id: parent.map(str::to_string),
            slug: None,
            parent_slug: None,
        }
    }

    fn item(list_id: &str, kind: ListItemKind, id: &str) -> ListItemEntry {
        ListItemEntry {
            list_id: list_id.into(),
            kind,
            id: id.into(),
            label: None,
            inherited_from_list_id: None,
            duplicate_of_item_id: None,
        }
    }

    fn lists_input() -> ListsTreeInput {
        let titles: HashMap<String, String> = [
            ("paper:p1", "β-VAE: Learning"),
            ("paper:p2", "Disentanglement: a review"),
            ("paper:p3", "Screening methods"),
            ("vault_page:n1", "Disentanglement reading cluster"),
        ]
        .into_iter()
        .map(|(key, title)| (key.to_string(), title.to_string()))
        .collect();
        let member_rank: HashMap<String, i64> =
            [("paper".to_string(), 10), ("vault_page".to_string(), 20)]
                .into_iter()
                .collect();
        ListsTreeInput {
            lists: vec![
                list("l1", "Latent spaces", None),
                list("l2", "Disentanglement", Some("l1")),
                list("l3", "Screening — September", None),
            ],
            items: vec![
                item("l2", ListItemKind::Paper, "p1"),
                item("l2", ListItemKind::Paper, "p2"),
                item("l2", ListItemKind::VaultPage, "n1"),
                item("l1", ListItemKind::Paper, "p3"),
                ListItemEntry {
                    inherited_from_list_id: Some("l1".into()),
                    ..item("l3", ListItemKind::Paper, "p1")
                },
                ListItemEntry {
                    duplicate_of_item_id: Some("p1".into()),
                    ..item("l3", ListItemKind::Paper, "p9")
                },
            ],
            titles,
            member_rank: Some(member_rank),
        }
    }

    #[test]
    fn five_roots_overleaf_last_always() {
        let tree = build_workspace_tree(&WorkspaceTreeInput::default());
        assert_eq!(labels(&tree), ["Notes", "Papers", "Report", "Log", "Overleaf"]);
        assert!(tree.iter().all(|node| node.children.is_empty()));
    }

    #[test]
    fn overleaf_is_a_folder_whose_rows_are_its_projects() {
        let tree = build_workspace_tree(&WorkspaceTreeInput {
            overleaf_projects: vec![
                OverleafProject { id: "ol1".into(), name: "AIML LAB2".into() },
                OverleafProject { id: "ol2".into(), name: "Thesis".into() },
            ],
            ..Default::default()
        });
        let overleaf = &tree[4];
        assert_eq!(overleaf.kind, TreeNodeKind::Folder);
        assert_eq!(overleaf.key, "overleaf");
        assert!(!is_document_node(overleaf));
        let rows: Vec<(String, Option<String>, String, bool)> = overleaf
            .children
            .iter()
            .map(|node| {
                (
                    node.key.clone(),
                    node.id.clone(),
                    node.label.clone(),
                    is_document_node(node),
                )
            })
            .collect();
        assert_eq!(
            rows,
            [
                ("overleaf:ol1".to_string(), Some("ol1".to_string()), "AIML LAB2".to_string(), true),
                ("overleaf:ol2".to_string(), Some("ol2".to_string()), "Thesis".to_string(), true),
            ]
        );
        assert!(overleaf.children.iter().all(|node| node.kind == TreeNodeKind::Overleaf));
    }

    #[test]
    fn log_entries_are_documents_under_a_log_root_newest_first() {
        let tree = build_workspace_tree(&WorkspaceTreeInput {
            log_entries: vec![
                WorkspaceLogEntry { id: "l1".into(), entry_date: "2026-03-14".into() },
                WorkspaceLogEntry { id: "l2".into(), entry_date: "2026-04-02".into() },
                WorkspaceLogEntry { id: "l3".into(), entry_date: "2026-01-09".into() },
            ],
            ..Default::default()
        });
        let log = &tree[3];
        assert_eq!(log.label, "Log");
        assert_eq!(labels(&log.children), ["2026-04-02", "2026-03-14", "2026-01-09"]);
        let rows: Vec<(TreeNodeKind, Option<String>, String)> = log
            .children
            .iter()
            .map(|node| (node.kind, node.id.clone(), node.path.clone()))
            .collect();
        assert_eq!(
            rows,
            [
                (TreeNodeKind::LogEntry, Some("l2".to_string()), "logbook/2026/04/2026-04-02--l2.log.md".to_string()),
                (TreeNodeKind::LogEntry, Some("l1".to_string()), "logbook/2026/03/2026-03-14--l1.log.md".to_string()),
                (TreeNodeKind::LogEntry, Some("l3".to_string()), "logbook/2026/01/2026-01-09--l3.log.md".to_string()),
            ]
        );
        // A document, so quick open searches it and the explorer can open a tab.
        assert!(flatten_tree(&tree).iter().any(|node| node.kind == TreeNodeKind::LogEntry));
    }

    #[test]
    fn a_note_nests_under_its_parent_and_carries_the_mirrored_path() {
        let tree = build_workspace_tree(&WorkspaceTreeInput {
            notes: vec![note("a", "Method", None), note("b", "Baselines", Some("a"))],
            ..Default::default()
        });
        let notes = &tree[0];
        assert_eq!(notes.children.len(), 1);
        let method = &notes.children[0];
        assert_eq!(method.key, "vault_page:a");
        assert_eq!(method.path, "notes/method/method.note.md");
        assert_eq!(method.children[0].path, "notes/method/baselines.note.md");
    }

    #[test]
    fn children_sort_by_label_not_by_arrival_order() {
        let tree = build_workspace_tree(&WorkspaceTreeInput {
            notes: vec![
                note("z", "Zeta", None),
                note("a", "alpha", None),
                note("m", "Chapter 10", None),
                note("n", "Chapter 2", None),
            ],
            ..Default::default()
        });
        assert_eq!(labels(&tree[0].children), ["alpha", "Chapter 2", "Chapter 10", "Zeta"]);
    }

    #[test]
    fn a_note_whose_parent_is_gone_stays_visible_at_the_root() {
        let tree = build_workspace_tree(&WorkspaceTreeInput {
            notes: vec![note("orphan", "Orphan", Some("deleted"))],
            ..Default::default()
        });
        assert_eq!(ids(&tree[0].children), ["orphan"]);
    }

    #[test]
    fn a_note_that_claims_itself_as_parent_does_not_hang_the_tree() {
        let tree = build_workspace_tree(&WorkspaceTreeInput {
            notes: vec![note("loop", "Loop", Some("loop"))],
            ..Default::default()
        });
        assert_eq!(tree[0].children.len(), 1);
        assert!(tree[0].children[0].children.is_empty());
    }

    #[test]
    fn a_two_note_parent_cycle_keeps_both_notes_and_their_children() {
        let tree = build_workspace_tree(&WorkspaceTreeInput {
            notes: vec![
                note("a", "Alpha", Some("b")),
                note("b", "Beta", Some("a")),
                note("c", "Child", Some("a")),
            ],
            ..Default::default()
        });
        let notes = &tree[0];
        let mut all = ids(&every_node(&notes.children));
        all.sort();
        assert_eq!(all, ["a", "b", "c"]);
        assert_eq!(ids(&notes.children), ["a", "b"]);
        assert_eq!(ids(&notes.children[0].children), ["c"]);
    }

    #[test]
    fn a_node_hanging_off_a_cycle_nests_normally() {
        let tree = build_workspace_tree(&WorkspaceTreeInput {
            notes: vec![
                note("a", "Alpha", Some("c")),
                note("b", "Beta", Some("a")),
                note("c", "Gamma", Some("b")),
                note("d", "Delta", Some("b")),
            ],
            ..Default::default()
        });
        let mut all = ids(&every_node(&tree[0].children));
        all.sort();
        assert_eq!(all, ["a", "b", "c", "d"]);
        let beta = every_node(&tree[0].children)
            .into_iter()
            .find(|node| node.id.as_deref() == Some("b"))
            .expect("beta is in the tree");
        assert!(beta.children.iter().any(|node| node.id.as_deref() == Some("d")));
    }

    #[test]
    fn a_paper_with_no_note_is_listed_and_flagged_never_hidden() {
        let tree = build_workspace_tree(&WorkspaceTreeInput {
            papers: vec![
                paper("p1", "Attention Is All You Need", true),
                paper("p2", "Batch Norm", false),
            ],
            ..Default::default()
        });
        let papers = &tree[1];
        assert_eq!(labels(&papers.children), ["Attention Is All You Need", "Batch Norm"]);
        assert!(papers.children.iter().all(|node| node.kind == TreeNodeKind::Folder));
        let shape: Vec<Vec<(TreeNodeKind, String)>> = papers
            .children
            .iter()
            .map(|row| row.children.iter().map(|c| (c.kind, c.label.clone())).collect())
            .collect();
        let expected = vec![
            (TreeNodeKind::PaperPdf, "PDF".to_string()),
            (TreeNodeKind::Paper, "Notes".to_string()),
        ];
        assert_eq!(shape, vec![expected.clone(), expected]);
        let [pdf, notes] = papers.children[1].children.as_slice() else {
            panic!("a paper has two files");
        };
        assert!(!pdf.missing_note);
        assert!(notes.missing_note);
        assert!(pdf.path.starts_with("papers/") && pdf.path.ends_with(".pdf"));
        assert!(notes.path.starts_with("papers/") && notes.path.ends_with(".paper.md"));
    }

    #[test]
    fn an_untitled_entity_gets_a_label_rather_than_an_empty_row() {
        let tree = build_workspace_tree(&WorkspaceTreeInput {
            notes: vec![note("u", "   ", None)],
            ..Default::default()
        });
        assert_eq!(tree[0].children[0].label, "Untitled");
    }

    #[test]
    fn flattening_drops_the_folders_and_keeps_every_document_depth_first() {
        let tree = build_workspace_tree(&WorkspaceTreeInput {
            notes: vec![note("a", "Method", None), note("b", "Baselines", Some("a"))],
            papers: vec![paper("p1", "Attention", true)],
            report_sections: vec![SectionNode {
                id: "s1".into(),
                title: "Results".into(),
                parent_id: None,
            }],
            ..Default::default()
        });
        let keys: Vec<String> = flatten_tree(&tree).into_iter().map(|node| node.key).collect();
        assert_eq!(
            keys,
            ["vault_page:a", "vault_page:b", "paper_pdf:p1", "paper:p1", "report_section:s1"]
        );
    }

    #[test]
    fn the_section_header_is_the_lists_root_so_lists_sit_at_level_one() {
        let tree = build_lists_tree(&lists_input());
        assert_eq!(labels(&tree), ["Latent spaces", "Screening — September"]);
        assert!(tree.iter().all(|node| node.kind == TreeNodeKind::ReadingList));
    }

    #[test]
    fn a_list_nests_under_its_parent_list_and_carries_the_mirrored_path() {
        let tree = build_lists_tree(&lists_input());
        let parent = tree.iter().find(|node| node.id.as_deref() == Some("l1")).expect("l1");
        let shape: Vec<(String, TreeNodeKind)> = parent
            .children
            .iter()
            .map(|node| (node.label.clone(), node.kind))
            .collect();
        assert_eq!(
            shape,
            [
                ("Disentanglement".to_string(), TreeNodeKind::ReadingList),
                ("Screening methods".to_string(), TreeNodeKind::Paper),
            ]
        );
        assert_eq!(parent.path, "reading-lists/latent-spaces.list.md");
        assert_eq!(parent.children[0].path, "reading-lists/latent-spaces/disentanglement.list.md");
    }

    #[test]
    fn a_two_list_parent_cycle_keeps_both_lists() {
        let tree = build_lists_tree(&ListsTreeInput {
            lists: vec![list("x", "X", Some("y")), list("y", "Y", Some("x"))],
            ..Default::default()
        });
        let mut ids_found: Vec<String> = every_node(&tree)
            .into_iter()
            .filter(|node| node.kind == TreeNodeKind::ReadingList)
            .map(|node| node.id.unwrap_or_default())
            .collect();
        ids_found.sort();
        assert_eq!(ids_found, ["x", "y"]);
    }

    #[test]
    fn members_hang_off_their_list_papers_first_and_each_sorted_by_label() {
        let tree = build_lists_tree(&lists_input());
        let nested = tree
            .iter()
            .find(|node| node.id.as_deref() == Some("l1"))
            .expect("l1")
            .children[0]
            .clone();
        assert_eq!(
            labels(&nested.children),
            ["Disentanglement: a review", "β-VAE: Learning", "Disentanglement reading cluster"]
        );
    }

    #[test]
    fn a_top_level_lists_members_are_papers_first_then_notes_each_sorted() {
        let tree = build_lists_tree(&ListsTreeInput {
            lists: vec![list("l2", "Disentanglement", None)],
            ..lists_input()
        });
        let kinds: Vec<TreeNodeKind> = tree[0].children.iter().map(|node| node.kind).collect();
        assert_eq!(kinds, [TreeNodeKind::Paper, TreeNodeKind::Paper, TreeNodeKind::VaultPage]);
    }

    #[test]
    fn a_members_key_is_prefixed_by_its_list_but_its_kind_and_id_are_the_entitys() {
        let tree = build_lists_tree(&lists_input());
        let nested = tree
            .iter()
            .find(|node| node.id.as_deref() == Some("l1"))
            .expect("l1")
            .children[0]
            .clone();
        let paper = nested
            .children
            .iter()
            .find(|node| node.id.as_deref() == Some("p1"))
            .expect("p1 under l2");
        assert_eq!(paper.key, "reading_list:l2/paper:p1");
        assert_eq!(paper.kind, TreeNodeKind::Paper);
        assert_eq!(paper.id.as_deref(), Some("p1"));
        assert!(paper.is_member);
    }

    #[test]
    fn the_same_paper_under_two_lists_is_two_rows_with_two_keys() {
        let tree = build_lists_tree(&lists_input());
        let p1: Vec<WorkspaceTreeNode> = every_node(&tree)
            .into_iter()
            .filter(|node| node.id.as_deref() == Some("p1"))
            .collect();
        assert_eq!(p1.len(), 2, "one under its parent list, one inherited into Screening");
        let keys: Vec<&str> = p1.iter().map(|node| node.key.as_str()).collect();
        assert_eq!(keys, ["reading_list:l2/paper:p1", "reading_list:l3/paper:p1"]);
    }

    #[test]
    fn a_member_row_reuses_the_members_own_path_not_the_lists() {
        let tree = build_lists_tree(&lists_input());
        let nested = tree
            .iter()
            .find(|node| node.id.as_deref() == Some("l1"))
            .expect("l1")
            .children[0]
            .clone();
        let paper = nested
            .children
            .iter()
            .find(|node| node.id.as_deref() == Some("p1"))
            .expect("p1 under l2");
        assert!(paper.path.ends_with(".md"));
        assert!(!paper.path.contains("reading-lists/"));
    }

    #[test]
    fn an_inherited_membership_is_flagged_and_names_where_it_came_from() {
        let tree = build_lists_tree(&lists_input());
        let screening = tree
            .iter()
            .find(|node| node.id.as_deref() == Some("l3"))
            .expect("l3");
        let inherited = &screening.children[0];
        assert!(inherited.inherited);
        assert_eq!(inherited.inherited_from.as_deref(), Some("Latent spaces"));
    }

    #[test]
    fn a_duplicate_is_hidden_because_that_decision_belongs_to_the_screening_screen() {
        let tree = build_lists_tree(&lists_input());
        let screening = tree
            .iter()
            .find(|node| node.id.as_deref() == Some("l3"))
            .expect("l3");
        assert!(!screening.children.iter().any(|node| node.id.as_deref() == Some("p9")));
    }

    #[test]
    fn quick_open_never_lists_a_member_row_which_would_be_the_same_document_twice() {
        let files = build_workspace_tree(&WorkspaceTreeInput {
            papers: vec![paper("p1", "β-VAE: Learning", true)],
            ..Default::default()
        });
        let lists = build_lists_tree(&lists_input());
        let mut indexed = flatten_tree(&files);
        indexed.extend(flatten_tree(&lists));

        // Files contributes the paper's two files once each. The member rows contribute nothing.
        let p1_keys: Vec<String> = indexed
            .iter()
            .filter(|node| node.id.as_deref() == Some("p1"))
            .map(|node| node.key.clone())
            .collect();
        assert_eq!(p1_keys, ["paper_pdf:p1", "paper:p1"]);
        // The list rows themselves are documents and are still indexed.
        assert_eq!(
            indexed.iter().filter(|node| node.kind == TreeNodeKind::ReadingList).count(),
            3
        );
    }

    #[test]
    fn membership_is_a_lookup_so_a_files_row_can_say_how_many_lists_it_is_in() {
        let titles: HashMap<String, String> = [
            ("reading_list:l1", "Latent spaces"),
            ("reading_list:l2", "Disentanglement"),
            ("reading_list:l3", "Screening — September"),
        ]
        .into_iter()
        .map(|(key, title)| (key.to_string(), title.to_string()))
        .collect();
        let membership = list_membership(&lists_input().items, &titles);
        assert_eq!(
            membership.get("paper:p1"),
            Some(&vec!["Disentanglement".to_string(), "Screening — September".to_string()])
        );
        assert_eq!(membership.get("paper:p9"), None, "a duplicate is not a membership");
    }

    #[test]
    fn a_match_keeps_its_ancestors_and_opens_them_so_the_match_shows() {
        let tree = build_lists_tree(&lists_input());
        let expanded: HashSet<String> = ["reading_list:l1".to_string()].into_iter().collect();
        let rows = visible_rows(&tree, &expanded);
        let filtered = filter_rows(&rows, "screening methods");
        assert_eq!(labels_of_rows(&filtered.rows), ["Latent spaces", "Screening methods"]);
        let expand: HashSet<String> = [
            "reading_list:l1".to_string(),
            "reading_list:l1/paper:p3".to_string(),
        ]
        .into_iter()
        .collect();
        assert_eq!(filtered.expand, expand);
    }

    #[test]
    fn an_empty_filter_keeps_every_row_and_opens_nothing() {
        let rows = visible_rows(&build_lists_tree(&lists_input()), &HashSet::new());
        let filtered = filter_rows(&rows, "   ");
        assert_eq!(filtered.rows.len(), rows.len());
        assert!(filtered.expand.is_empty());
    }

    fn labels_of_rows(rows: &[VisibleRow]) -> Vec<String> {
        rows.iter().map(|row| row.node.label.clone()).collect()
    }
}
