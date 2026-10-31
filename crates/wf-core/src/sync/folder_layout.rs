//! Where each entity lives in the workspace folder. Port of
//! `packages/core/src/workspace/folder-layout.ts`. Slug and id lengths count
//! UTF-16 units, as the TypeScript does.

use std::collections::{HashMap, HashSet};

use unicode_normalization::UnicodeNormalization;

use crate::search::js_text::{is_letter_or_number, utf16_len};

/// Bookkeeping directory inside a project (or the root).
pub const WORKSPACE_META_DIR: &str = ".weaveforge";

/// Asset tree shared by every project: `assets/<scope>/...`.
pub const ASSET_DIR: &str = "assets";

/// A paper's PDF copies, relative to its project.
pub const PAPER_PDF_DIR: &str = "papers/pdf";

/// A paper's full-text HTML copies, relative to its project.
pub const PAPER_HTML_DIR: &str = "papers/html";

/// Longest slug, in UTF-16 units.
const SLUG_MAX_UTF16: usize = 80;

/// Kinds of entity the folder holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum WorkspaceEntityType {
    /// A note.
    VaultPage,
    /// An ink note: a note whose strokes sit beside it.
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
    /// A dated logbook entry.
    LogEntry,
}

impl WorkspaceEntityType {
    /// The type's name as the TypeScript spells it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::VaultPage => "vault_page",
            Self::InkPage => "ink_page",
            Self::Paper => "paper",
            Self::ReadingList => "reading_list",
            Self::ReportSection => "report_section",
            Self::Experiment => "experiment",
            Self::Milestone => "milestone",
            Self::LogEntry => "log_entry",
        }
    }
}

/// Top-level directory per entity type.
pub const ENTITY_DIRS: &[(WorkspaceEntityType, &str)] = &[
    (WorkspaceEntityType::VaultPage, "notes"),
    // Same tree and link table as a note; only the body differs.
    (WorkspaceEntityType::InkPage, "notes"),
    (WorkspaceEntityType::Paper, "papers"),
    (WorkspaceEntityType::ReadingList, "reading-lists"),
    (WorkspaceEntityType::ReportSection, "report"),
    (WorkspaceEntityType::Experiment, "experiments"),
    (WorkspaceEntityType::Milestone, "plan"),
    (WorkspaceEntityType::LogEntry, "logbook"),
];

/// The kind spelled into the filename: `methods--a1b2c3.note.md`.
///
/// A hint only: frontmatter and the directory decide what a file is.
pub const KIND_SUFFIX: &[(WorkspaceEntityType, &str)] = &[
    (WorkspaceEntityType::VaultPage, "note"),
    // `.ink.md`: still markdown; the strokes are in the `.ink/<id>/` sidecar.
    (WorkspaceEntityType::InkPage, "ink"),
    (WorkspaceEntityType::Paper, "paper"),
    (WorkspaceEntityType::ReadingList, "list"),
    (WorkspaceEntityType::ReportSection, "report"),
    (WorkspaceEntityType::Experiment, "experiment"),
    (WorkspaceEntityType::Milestone, "milestone"),
    (WorkspaceEntityType::LogEntry, "log"),
];

/// The directory name for an entity type, from `ENTITY_DIRS`.
#[must_use]
pub fn entity_dir_name(entity: WorkspaceEntityType) -> &'static str {
    ENTITY_DIRS
        .iter()
        .find(|(t, _)| *t == entity)
        .map_or("", |(_, name)| *name)
}

/// The kind suffix for an entity type, from `KIND_SUFFIX`.
#[must_use]
pub fn kind_suffix(entity: WorkspaceEntityType) -> &'static str {
    KIND_SUFFIX
        .iter()
        .find(|(t, _)| *t == entity)
        .map_or("", |(_, suffix)| *suffix)
}

fn type_for_suffix(suffix: &str) -> Option<WorkspaceEntityType> {
    KIND_SUFFIX
        .iter()
        .find(|(_, s)| *s == suffix)
        .map(|(t, _)| *t)
}

/// `[a-z_]+`, the shape the TypeScript regex accepts for a kind.
fn is_kind_token(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase() || c == '_')
}

/// The type a path's suffix claims, or `None` when it carries none.
#[must_use]
pub fn parse_kind_suffix(path: &str) -> Option<WorkspaceEntityType> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let (_, kind) = name.strip_suffix(".md")?.rsplit_once('.')?;
    if is_kind_token(kind) {
        type_for_suffix(kind)
    } else {
        None
    }
}

/// The filename with its kind suffix and extension removed. A trailing
/// segment that is not a known kind stays part of the title.
#[must_use]
pub fn strip_kind_suffix(name: &str) -> String {
    let stem = name.strip_suffix(".md").unwrap_or(name);
    match stem.rsplit_once('.') {
        Some((head, kind)) if is_kind_token(kind) && type_for_suffix(kind).is_some() => {
            head.to_owned()
        }
        _ => stem.to_owned(),
    }
}

/// Combining marks U+0300..=U+036F, dropped after NFKD.
fn is_combining_mark(ch: char) -> bool {
    ('\u{300}'..='\u{36f}').contains(&ch)
}

/// NFKD, marks dropped, each run of non-letters or non-numbers as one `-`,
/// dashes trimmed at both ends.
fn fold_separators(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut in_gap = false;
    for ch in title.nfkd().filter(|c| !is_combining_mark(*c)) {
        if is_letter_or_number(ch) {
            out.push(ch);
            in_gap = false;
        } else if !in_gap {
            out.push('-');
            in_gap = true;
        }
    }
    out.trim_matches('-').to_owned()
}

/// The longest prefix of at most `max` UTF-16 units. A char that would
/// straddle the cut is dropped whole, so no surrogate is left alone.
fn truncate_utf16(s: &str, max: usize) -> &str {
    if utf16_len(s) <= max {
        return s;
    }
    let mut units = 0;
    for (at, ch) in s.char_indices() {
        units += ch.len_utf16();
        if units > max {
            return s.get(..at).unwrap_or("");
        }
    }
    s
}

/// `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`, lowercase.
fn is_windows_reserved(slug: &str) -> bool {
    if matches!(slug, "con" | "prn" | "aux" | "nul") {
        return true;
    }
    slug.strip_prefix("com")
        .or_else(|| slug.strip_prefix("lpt"))
        .is_some_and(|digit| digit.len() == 1 && digit.chars().all(|c| ('1'..='9').contains(&c)))
}

/// Filesystem-safe, human-readable slug. `fallback` when nothing is left.
/// Reserved Windows device names get a `-file` suffix, so the folder
/// round-trips on Windows.
#[must_use]
pub fn slug_for(title: &str, fallback: &str) -> String {
    let lower = fold_separators(title).to_lowercase();
    // Dashes are trimmed before the cut, as in the TS, so a cut can leave one.
    let slug = truncate_utf16(&lower, SLUG_MAX_UTF16);
    if slug.is_empty() {
        return fallback.to_owned();
    }
    if is_windows_reserved(slug) {
        format!("{slug}-file")
    } else {
        slug.to_owned()
    }
}

/// Short id suffix used to break slug collisions inside one directory.
#[must_use]
pub fn id_suffix(id: &str) -> String {
    let kept: String = id
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(6)
        .collect();
    if kept.is_empty() {
        "x".to_owned()
    } else {
        kept
    }
}

/// The project a run is scoped to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceProject {
    /// Stable project id; only its ASCII alphanumerics reach the folder name.
    pub id: String,
    /// Display name, slugged into the folder name.
    pub name: String,
}

/// `slug--id6`, the folder name for a project.
#[must_use]
pub fn project_dir(project: &WorkspaceProject) -> String {
    format!(
        "{}--{}",
        slug_for(&project.name, "project"),
        id_suffix(&project.id)
    )
}

/// The top-level directory for an entity type, inside a project when given one.
#[must_use]
pub fn entity_dir(entity: WorkspaceEntityType, project_root: &str) -> String {
    let name = entity_dir_name(entity);
    if project_root.is_empty() {
        name.to_owned()
    } else {
        format!("{project_root}/{name}")
    }
}

/// A project's own bookkeeping directory.
#[must_use]
pub fn project_meta_dir(project_root: &str) -> String {
    format!("{project_root}/{WORKSPACE_META_DIR}")
}

/// One node of a tree entity. An empty `parent_id` counts as no parent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FolderNode {
    /// Node id.
    pub id: String,
    /// Title, slugged into the file or folder name.
    pub title: String,
    /// Parent node id, if any.
    pub parent_id: Option<String>,
}

fn parent_of(node: &FolderNode) -> Option<&str> {
    node.parent_id.as_deref().filter(|p| !p.is_empty())
}

fn child_counts(nodes: &[FolderNode]) -> HashMap<&str, usize> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for node in nodes {
        if let Some(parent) = parent_of(node) {
            *counts.entry(parent).or_insert(0) += 1;
        }
    }
    counts
}

/// Slugs, lookup and memoised directories for one `tree_paths` call.
struct TreeLayout<'a> {
    root: String,
    by_id: HashMap<&'a str, &'a FolderNode>,
    slug_of: HashMap<&'a str, String>,
    dir_cache: HashMap<&'a str, String>,
}

impl<'a> TreeLayout<'a> {
    /// Slugs are unique per parent; a collision gets `--` and the id suffix.
    fn new(nodes: &'a [FolderNode], root: String) -> Self {
        let by_id: HashMap<&str, &FolderNode> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();
        let mut used_per_parent: HashMap<&str, HashSet<String>> = HashMap::new();
        let mut slug_of: HashMap<&str, String> = HashMap::new();
        for node in nodes {
            let used = used_per_parent
                .entry(parent_of(node).unwrap_or(""))
                .or_default();
            let mut slug = slug_for(&node.title, "untitled");
            if used.contains(&slug) {
                slug = format!("{slug}--{}", id_suffix(&node.id));
            }
            let _ = used.insert(slug.clone());
            let _ = slug_of.insert(node.id.as_str(), slug);
        }
        Self {
            root,
            by_id,
            slug_of,
            dir_cache: HashMap::new(),
        }
    }

    fn slug(&self, node: &FolderNode) -> String {
        self.slug_of
            .get(node.id.as_str())
            .cloned()
            .unwrap_or_default()
    }

    /// The directory a node's children live in. A corrupted parent chain
    /// (a cycle) stops at the root rather than looping.
    fn dir_for(&mut self, node: &'a FolderNode, seen: &mut HashSet<&'a str>) -> String {
        if let Some(cached) = self.dir_cache.get(node.id.as_str()) {
            return cached.clone();
        }
        if !seen.insert(node.id.as_str()) {
            return self.root.clone();
        }
        let parent = parent_of(node).and_then(|p| self.by_id.get(p).copied());
        let parent_dir = match parent {
            Some(parent) => self.dir_for(parent, seen),
            None => self.root.clone(),
        };
        let dir = format!("{parent_dir}/{}", self.slug(node));
        let _ = self.dir_cache.insert(node.id.as_str(), dir.clone());
        dir
    }
}

/// Path for one node. A node with children is a folder note: a directory
/// holding a same-named file for its own body, as Obsidian lays it out.
fn node_path<'a>(
    layout: &mut TreeLayout<'a>,
    node: &'a FolderNode,
    has_children: bool,
    ext: &str,
) -> String {
    let slug = layout.slug(node);
    let parent = parent_of(node).and_then(|p| layout.by_id.get(p).copied());
    let parent_dir = match parent {
        Some(parent) => layout.dir_for(parent, &mut HashSet::new()),
        None => layout.root.clone(),
    };
    if has_children {
        format!("{}/{slug}{ext}", layout.dir_for(node, &mut HashSet::new()))
    } else {
        format!("{parent_dir}/{slug}{ext}")
    }
}

/// `(node id, path)` for every id, in first-seen order. A repeated id keeps
/// its first position and its last path, as the TypeScript `Map` does.
#[must_use]
pub fn tree_paths(
    nodes: &[FolderNode],
    entity: WorkspaceEntityType,
    project_root: &str,
) -> Vec<(String, String)> {
    let ext = format!(".{}.md", kind_suffix(entity));
    let counts = child_counts(nodes);
    let mut layout = TreeLayout::new(nodes, entity_dir(entity, project_root));
    let mut out: Vec<(String, String)> = Vec::with_capacity(nodes.len());
    let mut position: HashMap<&str, usize> = HashMap::new();
    for node in nodes {
        let has_children = counts.get(node.id.as_str()).is_some_and(|n| *n > 0);
        let path = node_path(&mut layout, node, has_children, &ext);
        match position
            .get(node.id.as_str())
            .and_then(|&at| out.get_mut(at))
        {
            Some(entry) => entry.1 = path,
            None => {
                let _ = position.insert(node.id.as_str(), out.len());
                out.push((node.id.clone(), path));
            }
        }
    }
    out
}

/// Flat path for a non-tree entity, with an id suffix so titles may repeat.
#[must_use]
pub fn flat_path(entity: WorkspaceEntityType, id: &str, title: &str, project_root: &str) -> String {
    format!(
        "{}/{}--{}.{}.md",
        entity_dir(entity, project_root),
        slug_for(title, "untitled"),
        id_suffix(id),
        kind_suffix(entity),
    )
}

/// Logbook is dated, not titled: `logbook/2026/03/2026-03-14--ab12cd.log.md`.
#[must_use]
pub fn log_path(id: &str, entry_date: &str, project_root: &str) -> String {
    let mut parts = entry_date.split('-');
    let year = parts.next().unwrap_or("unknown");
    let month = parts.next().unwrap_or("00");
    format!(
        "{}/{year}/{month}/{entry_date}--{}.{}.md",
        entity_dir(WorkspaceEntityType::LogEntry, project_root),
        id_suffix(id),
        kind_suffix(WorkspaceEntityType::LogEntry),
    )
}

/// Which tree an asset belongs to under `assets/`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssetScope {
    /// Note assets.
    Notes,
    /// Paper assets.
    Papers,
    /// Report assets.
    Report,
}

impl AssetScope {
    /// The directory name under `assets/`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Notes => "notes",
            Self::Papers => "papers",
            Self::Report => "report",
        }
    }
}

/// `papers/pdf/<paperId>.pdf` inside a project.
#[must_use]
pub fn paper_pdf_path(paper_id: &str, project_root: &str) -> String {
    format!(
        "{}/pdf/{paper_id}.pdf",
        entity_dir(WorkspaceEntityType::Paper, project_root)
    )
}

/// `papers/html/<paperId>.html` inside a project.
#[must_use]
pub fn paper_html_path(paper_id: &str, project_root: &str) -> String {
    format!(
        "{}/html/{paper_id}.html",
        entity_dir(WorkspaceEntityType::Paper, project_root)
    )
}

/// `assets/<scope>/<storage path>`. The storage path keeps its owner and
/// entity segments so two notes' `diagram.png` do not collide.
#[must_use]
pub fn asset_path(scope: AssetScope, storage_path: &str) -> String {
    format!("{ASSET_DIR}/{}/{storage_path}", scope.as_str())
}
