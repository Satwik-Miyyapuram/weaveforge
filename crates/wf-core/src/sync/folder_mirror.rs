//! Port of `packages/core/src/workspace/folder-mirror.ts`: writes a workspace
//! snapshot into its project folder, leaving alone whatever the reader edited.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

use crate::sync::change_origin::digest_text;
use crate::sync::folder_layout::WorkspaceProject;
use crate::sync::json_entities::is_app_owned_path;
use crate::sync::merge_vault_page::{VaultPageBase, vault_page_base};
use crate::sync::serialize::{SerializedAsset, serialize_workspace};
use crate::sync::workspace_fs::{FsError, WorkspaceFs};
use crate::sync::workspace_snapshot::WorkspaceSnapshot;

/// What one run did.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct MirrorResult {
    /// Paths written, in write order.
    pub written: Vec<String>,
    /// Paths removed because the workspace no longer owns them.
    pub removed: Vec<String>,
    /// Unchanged files, skipped without a write.
    pub unchanged: usize,
    /// Digest of every markdown/data file the folder now holds, by path, in write order (each path once).
    pub mirrored: Vec<(String, String)>,
    /// Paths left as the folder has them, because they changed since the mirror wrote them.
    pub held_back: Vec<String>,
    /// Note bases, in write order.
    pub bases: Vec<(String, VaultPageBase)>,
}

/// Fetches a blob for an asset by its storage path.
pub type FetchAsset<'a> = &'a mut dyn FnMut(&str) -> Option<Vec<u8>>;

/// Options for one run.
pub struct MirrorOptions<'a> {
    /// The project this snapshot belongs to; every path is written inside its folder.
    pub project: &'a WorkspaceProject,
    /// Paths written by the previous run, so departures can be detected.
    pub previous_paths: &'a [String],
    /// The digest of each path the last run wrote; tells a reader's edit from a difference.
    pub base: Option<&'a HashMap<String, String>>,
    /// Fetches a blob for an asset the folder references.
    pub fetch_asset: Option<FetchAsset<'a>>,
}

/// Writes `snapshot` into the project folder, removing files that no longer belong.
///
/// # Errors
///
/// `mkdirp` and `write_file` failures propagate; the caller decides whether a
/// best-effort mirror should fail its save.
pub fn mirror_workspace<F: WorkspaceFs + ?Sized>(
    snapshot: &WorkspaceSnapshot,
    fs: &mut F,
    mut options: MirrorOptions<'_>,
) -> Result<MirrorResult, FsError> {
    let serialized = serialize_workspace(snapshot, options.project);
    let mut run = Run {
        fs,
        base: options.base,
        result: MirrorResult::default(),
        held: HashSet::new(),
    };
    for (path, content) in &serialized.files {
        run.mirror_file(path, content)?;
    }
    if let Some(fetch) = options.fetch_asset.as_deref_mut() {
        run.mirror_assets(&serialized.assets, fetch)?;
    }
    let present: HashSet<&str> = serialized
        .files
        .iter()
        .map(|(path, _)| path.as_str())
        .chain(
            serialized
                .assets
                .iter()
                .map(|asset| asset.folder_path.as_str()),
        )
        .collect();
    run.remove_departed(options.previous_paths, &present);
    Ok(run.result)
}

/// The digest map as a lookup, for passing a result's `mirrored` back in as `base`.
#[must_use]
pub fn digest_map(mirrored: &[(String, String)]) -> HashMap<String, String> {
    mirrored.iter().cloned().collect()
}

/// The accumulating state of one run.
struct Run<'a, F: ?Sized> {
    fs: &'a mut F,
    base: Option<&'a HashMap<String, String>>,
    result: MirrorResult,
    held: HashSet<String>,
}

impl<F: WorkspaceFs + ?Sized> Run<'_, F> {
    fn mirror_file(&mut self, path: &str, content: &str) -> Result<(), FsError> {
        upsert(&mut self.result.mirrored, path, digest_text(content));
        if let Some(note_base) = vault_page_base(path, content) {
            upsert(&mut self.result.bases, path, note_base);
        }
        // One read answers both "is it there" and "what does it say"; an error is missing.
        if let Ok(current) = self.fs.read_text(path) {
            if current == content || unstamped(path, &current) == unstamped(path, content) {
                upsert(&mut self.result.mirrored, path, digest_text(&current));
                self.result.unchanged += 1;
                return Ok(());
            }
            // The app-owned machinery is always rewritten; only data the reader may edit is held.
            if !is_app_owned_path(path)
                && self.edited_since_base(path, content, Some(current.as_str()))
            {
                self.hold(path);
                return Ok(());
            }
        }
        let dir = parent_dir(path);
        if !dir.is_empty() {
            self.fs.mkdirp(dir)?;
        }
        self.fs.write_file(path, content.as_bytes())?;
        self.result.written.push(path.to_owned());
        Ok(())
    }

    fn mirror_assets(
        &mut self,
        assets: &[SerializedAsset],
        fetch: &mut dyn FnMut(&str) -> Option<Vec<u8>>,
    ) -> Result<(), FsError> {
        for asset in assets {
            // Assets are immutable: the storage path carries a uuid, so an existing path is the same file.
            if self.fs.stat(&asset.folder_path).is_some() {
                self.result.unchanged += 1;
                continue;
            }
            let Some(bytes) = fetch(&asset.storage_path) else {
                continue;
            };
            let dir = parent_dir(&asset.folder_path);
            if !dir.is_empty() {
                self.fs.mkdirp(dir)?;
            }
            self.fs.write_file(&asset.folder_path, &bytes)?;
            self.result.written.push(asset.folder_path.clone());
        }
        Ok(())
    }

    fn remove_departed(&mut self, previous: &[String], present: &HashSet<&str>) {
        for path in previous {
            if present.contains(path.as_str()) {
                continue;
            }
            // A reader's edit outlives the entity it came from.
            if self.edited_since_base(path, "", None) {
                self.hold(path);
                continue;
            }
            // Best-effort: a file already gone is the outcome asked for.
            let _ = self.fs.remove(path, false);
            self.result.removed.push(path.clone());
        }
    }

    /// Whether the folder's copy of `path` changed since the base digest was recorded.
    fn edited_since_base(&self, path: &str, content: &str, known: Option<&str>) -> bool {
        let Some(recorded) = self.base.and_then(|base| base.get(path)) else {
            return false;
        };
        let on_disk = match known {
            Some(text) => text.to_owned(),
            None => match self.fs.read_text(path) {
                Ok(text) => text,
                Err(_) => return false,
            },
        };
        on_disk != content && digest_text(&on_disk) != *recorded
    }

    fn hold(&mut self, path: &str) {
        if self.held.insert(path.to_owned()) {
            self.result.held_back.push(path.to_owned());
        }
    }
}

/// Replaces the entry for `path` in place, or appends it: a map's first position wins.
fn upsert<V>(entries: &mut Vec<(String, V)>, path: &str, value: V) {
    if let Some(entry) = entries.iter_mut().find(|(p, _)| p.as_str() == path) {
        entry.1 = value;
    } else {
        entries.push((path.to_owned(), value));
    }
}

/// The folder a path lives in; empty for a root-level file such as `README.md`.
fn parent_dir(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(dir, _)| dir)
}

/// README and manifest with their export time blanked; a new time alone is not a change worth a commit.
fn unstamped<'a>(path: &str, text: &'a str) -> Cow<'a, str> {
    if path != "README.md" && !path.ends_with("/manifest.json") {
        return Cow::Borrowed(text);
    }
    let mut lines = split_lines(text);
    blank_exported(&mut lines);
    blank_generated_at(&mut lines);
    Cow::Owned(join_lines(&lines))
}

fn is_line_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// Lines as `(text, terminator)` pairs, so the text joins back to the original exactly.
fn split_lines(text: &str) -> Vec<(String, String)> {
    let mut lines = Vec::new();
    let mut line = String::new();
    for c in text.chars() {
        if is_line_terminator(c) {
            lines.push((std::mem::take(&mut line), c.to_string()));
        } else {
            line.push(c);
        }
    }
    lines.push((line, String::new()));
    lines
}

fn join_lines(lines: &[(String, String)]) -> String {
    lines
        .iter()
        .map(|(line, end)| format!("{line}{end}"))
        .collect()
}

/// The first `Exported ...` line becomes `Exported`, as the TS `^Exported .*\.$` replace does.
fn blank_exported(lines: &mut [(String, String)]) {
    if let Some(entry) = lines
        .iter_mut()
        .find(|(line, _)| line.starts_with("Exported ") && line.ends_with('.'))
    {
        entry.0 = "Exported".to_owned();
    }
}

/// The first `"generatedAt": "..."` line loses its value, as the TS `^(\s*"generatedAt": )".*"` replace does.
fn blank_generated_at(lines: &mut [(String, String)]) {
    let stripped = lines
        .iter()
        .enumerate()
        .find_map(|(i, (line, _))| strip_generated_at(line).map(|s| (i, s)));
    if let Some((i, s)) = stripped {
        lines[i].0 = s;
    }
}

/// The line with its `"generatedAt"` value removed, if it has one.
fn strip_generated_at(line: &str) -> Option<String> {
    const KEY: &str = "\"generatedAt\": ";
    let body = line.trim_start_matches(char::is_whitespace);
    if !body.starts_with(KEY) {
        return None;
    }
    let open = line.len() - body.len() + KEY.len();
    // The value runs to the last quote on the line, so it needs one after the opening quote.
    let close = line.rfind('"')?;
    if !line[open..].starts_with('"') || close <= open {
        return None;
    }
    Some(format!("{}{}", &line[..open], &line[close + 1..]))
}
