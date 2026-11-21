//! Where each entity lives in the workspace folder. Port of
//! `packages/core/src/workspace/parts-1.ts`. Slug and id lengths count
//! UTF-16 units, as the TypeScript does.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
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
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "snake_case")]
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
    // `.ink.md`: still markdown; the strokes are in the `<name>.ink/` folder beside it.
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

/// The folder segments of a picked file's path: backslashes read as separators, empty segments
/// dropped, then the first segment (the picked root, which folder pickers include) and the file
/// name removed (TS `folderSegments` in `vault/application/import-notes.ts`).
fn folder_segments(relative_path: &str) -> Vec<String> {
    let normalized = relative_path.replace('\\', "/");
    let parts: Vec<&str> = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    if parts.len() < 2 {
        return Vec::new();
    }
    parts[1..parts.len() - 1]
        .iter()
        .map(|part| (*part).to_owned())
        .collect()
}

/// The folder key of one file: its folder segments joined with `/`, empty for a file at the root.
#[must_use]
pub fn folder_key(relative_path: &str) -> String {
    folder_segments(relative_path).join("/")
}

/// Every folder that holds, or leads to, one of the files: each prefix of each file's folder path,
/// distinct, shallowest first so a parent is made before its children. Ties keep first-seen order.
#[must_use]
pub fn folder_keys(relative_paths: &[String]) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut keys: Vec<String> = Vec::new();
    for path in relative_paths {
        let segments = folder_segments(path);
        for end in 1..=segments.len() {
            let key = segments[..end].join("/");
            if seen.insert(key.clone()) {
                keys.push(key);
            }
        }
    }
    keys.sort_by_key(|key| key.split('/').count());
    keys
}

/// The title a note's file path gives: the last segment without `.md`, its `.note` or `.ink`
/// kind suffix and its `--id` suffix, trimmed. `Untitled` when nothing is left.
#[must_use]
pub fn folder_title_from_path(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    let name = name.strip_suffix(".md").unwrap_or(name);
    let name = name
        .strip_suffix(".note")
        .or_else(|| name.strip_suffix(".ink"))
        .unwrap_or(name);
    let title = strip_id_suffix(name).trim_matches(crate::search::js_text::is_js_whitespace);
    if title.is_empty() {
        "Untitled".to_owned()
    } else {
        title.to_owned()
    }
}

/// `name` without a trailing `--` plus 1 to 8 ASCII alphanumerics (the JS `/--[A-Za-z0-9]{1,8}$/`).
/// Only the last `--` can qualify: an earlier one is followed by that `--`, which has a dash.
fn strip_id_suffix(name: &str) -> &str {
    match name.rfind("--") {
        Some(at) => {
            let tail = &name[at + 2..];
            if (1..=8).contains(&tail.len()) && tail.bytes().all(|b| b.is_ascii_alphanumeric()) {
                &name[..at]
            } else {
                name
            }
        }
        None => name,
    }
}

/// The folder a deleted project lives in: `exact` when it is listed, else the one listed folder
/// ending in `tail` (the `--id` suffix). Two suffix matches are not surely this project's, so none;
/// nor is any suffix match when another project's tail (`other_tails`) is the same.
#[must_use]
pub fn pick_project_folder(
    dirs: &[String],
    exact: &str,
    tail: &str,
    other_tails: &[String],
) -> Option<String> {
    if dirs.iter().any(|dir| dir.as_str() == exact) {
        return Some(exact.to_owned());
    }
    if other_tails.iter().any(|other| other == tail) {
        return None;
    }
    let mut renamed = dirs.iter().filter(|dir| dir.ends_with(tail));
    match (renamed.next(), renamed.next()) {
        (Some(only), None) => Some(only.clone()),
        _ => None,
    }
}

/// Whether a folder's child names show a project folder: an entity dir or the `.weaveforge` meta
/// dir the mirror writes. A user folder that only shares the `--id6` name holds neither.
#[must_use]
pub fn holds_project_layout(children: &[String]) -> bool {
    children
        .iter()
        .any(|name| name == WORKSPACE_META_DIR || ENTITY_DIRS.iter().any(|(_, dir)| name == dir))
}

/// Settings file of a workspace.
pub const SETTINGS_PATH: &str = ".weaveforge/settings.json";

/// Workspace identity file.
pub const WORKSPACE_JSON_PATH: &str = ".weaveforge/workspace.json";

/// This device's local settings; never synced.
pub const DEVICE_SETTINGS_PATH: &str = ".weaveforge/local/device.json";

/// Local bases database; never synced.
pub const BASES_DB_PATH: &str = ".weaveforge/local/bases.sqlite";

/// Local search and cache database; never synced.
pub const CACHE_DB_PATH: &str = ".weaveforge/cache/cache.sqlite";

/// Trash folder for removed files, one dated subfolder per day.
pub const TRASH_DIR: &str = ".weaveforge/trash";

/// Splits `rel` into the path before its extension and the extension (dot included).
/// Only the last `.` of the file name counts; a leading dot is not an extension.
fn split_extension(rel: &str) -> (&str, &str) {
    let dir_end = rel.rfind('/').map_or(0, |i| i + 1);
    match rel[dir_end..].rfind('.') {
        Some(i) if i > 0 => (&rel[..dir_end + i], &rel[dir_end + i..]),
        _ => (rel, ""),
    }
}

/// Sidecar annotations file for a paper: `p/papers/x.pdf` -> `p/papers/x.annotations.json`.
#[must_use]
pub fn annotations_path(paper_rel: &str) -> String {
    format!("{}.annotations.json", split_extension(paper_rel).0)
}

/// Sidecar pins file for a paper: `p/papers/x.pdf` -> `p/papers/x.pins.json`.
#[must_use]
pub fn pins_path(paper_rel: &str) -> String {
    format!("{}.pins.json", split_extension(paper_rel).0)
}

/// Sidecar comments file for an item: `p/notes/x.md` -> `p/notes/x.comments.json`.
#[must_use]
pub fn comments_path(item_rel: &str) -> String {
    format!("{}.comments.json", split_extension(item_rel).0)
}

/// Metrics chunk of one run and batch inside an experiment folder.
#[must_use]
pub fn metrics_chunk_path(experiment_dir: &str, run: &str, batch_id: &str) -> String {
    format!("{experiment_dir}/metrics/{run}/{batch_id}.csv")
}

/// AI audit chunk for one month and batch.
#[must_use]
pub fn ai_audit_chunk_path(year_month: &str, batch_id: &str) -> String {
    format!(".weaveforge/ai/audit/{year_month}/{batch_id}.jsonl")
}

/// The Overleaf link file of a project; the root when `project_dir` is empty.
#[must_use]
pub fn overleaf_path(project_dir: &str) -> String {
    if project_dir.is_empty() {
        ".overleaf.json".to_owned()
    } else {
        format!("{project_dir}/.overleaf.json")
    }
}

/// Name of a conflict copy: `dir/name.ext` -> `dir/name.conflict-<stamp>.ext`.
#[must_use]
pub fn conflict_copy_path(rel: &str, stamp: &str) -> String {
    let (stem, ext) = split_extension(rel);
    format!("{stem}.conflict-{stamp}{ext}")
}

/// Name of the `n`th copy of a file; `n <= 1` keeps the name: `a/b.md`, 2 -> `a/b-2.md`.
#[must_use]
pub fn numbered_path(rel: &str, n: u32) -> String {
    if n <= 1 {
        return rel.to_owned();
    }
    let (stem, ext) = split_extension(rel);
    format!("{stem}-{n}{ext}")
}

/// Where a removed file goes: `.weaveforge/trash/<date>/<rel>`.
#[must_use]
pub fn trash_path(rel: &str, date: &str) -> String {
    format!("{TRASH_DIR}/{date}/{rel}")
}

/// [`trash_path`] for a `rel` that is a safe workspace path, so the result
/// stays inside the trash (F97-P2-14).
///
/// # Errors
/// [`UnsafePath`](crate::workspace::UnsafePath) when `rel` is empty, absolute,
/// drive-prefixed or climbs out with `..`.
pub fn checked_trash_path(rel: &str, date: &str) -> Result<String, crate::workspace::UnsafePath> {
    let rel = crate::workspace::safe_workspace_path(rel)?;
    Ok(trash_path(&rel, date))
}

/// Compact UTC stamp for file names: `2026-11-18T10:15:02.123Z` -> `20261118T101502Z`.
#[must_use]
pub fn compact_stamp(ms: i64) -> String {
    let iso = crate::sync::instant::format_instant(ms);
    let base: String = iso
        .chars()
        .take(19)
        .filter(|c| !matches!(c, '-' | ':'))
        .collect();
    format!("{base}Z")
}

/// UTC day for folder names: `2026-11-18`.
#[must_use]
pub fn day_stamp(ms: i64) -> String {
    crate::sync::instant::format_instant(ms)
        .chars()
        .take(10)
        .collect()
}
