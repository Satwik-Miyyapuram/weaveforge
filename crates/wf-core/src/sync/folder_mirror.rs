//! Port of `packages/core/src/workspace/folder-mirror.ts`: writes a workspace
//! snapshot into its project folder, leaving alone whatever the reader edited.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use serde::Serialize;
use serde_json::{Map, Value};

use crate::sync::change_origin::digest_text;
use crate::sync::folder_layout::WorkspaceProject;
use crate::sync::json_entities::is_app_owned_path;
use crate::sync::merge_vault_page::{VaultPageBase, vault_page_base};
use crate::sync::serialize::{SerializedAsset, serialize_workspace};
use crate::sync::workspace_fs::{FsError, WorkspaceFs, WorkspaceStat};
use crate::sync::workspace_snapshot::WorkspaceSnapshot;

/// What one run did.
#[derive(Clone, Debug, PartialEq, Default, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MirrorResult {
    /// Paths written, in write order.
    pub written: Vec<String>,
    /// Paths removed because the workspace no longer owns them.
    pub removed: Vec<String>,
    /// Unchanged files, skipped without a write.
    #[cfg_attr(feature = "specta", specta(type = u32))]
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

/// Carry a manifest forward across one mirror run (TS `nextManifest`): what the last sync
/// claimed minus what left, plus what this run wrote, each path once, in first-seen order.
///
/// Unchanged files are still ours, so a lost manifest re-learns the folder one write at a time.
#[must_use]
pub fn next_manifest(previous: &[String], written: &[String], removed: &[String]) -> Vec<String> {
    let removed: HashSet<&str> = removed.iter().map(String::as_str).collect();
    let mut seen: HashSet<&str> = HashSet::new();
    previous
        .iter()
        .filter(|path| !removed.contains(path.as_str()))
        .chain(written.iter())
        .filter(|path| seen.insert(path.as_str()))
        .cloned()
        .collect()
}

/// Whether a JSON file's text is an edit to record: no digest is recorded for it yet, or the
/// recorded digest differs from `text`.
#[must_use]
pub fn json_edit_since(base: &HashMap<String, String>, path: &str, text: &str) -> bool {
    match base.get(path) {
        None => true,
        Some(recorded) => *recorded != digest_text(text),
    }
}

/// Parses manifest text into a JSON value; `None` when absent or unparseable.
fn parse_manifest(text: Option<&str>) -> Option<Value> {
    serde_json::from_str(text?).ok()
}

/// The digest each path in the manifest's `paths` holds (TS `readMirrorBase`). A path with no
/// string digest maps to `""`. Absent, unparseable, or `paths`-less manifests give an empty map.
#[must_use]
pub fn read_mirror_base(text: Option<&str>) -> IndexMap<String, String> {
    let mut base = IndexMap::new();
    let Some(root) = parse_manifest(text).and_then(|value| value.as_object().cloned()) else {
        return base;
    };
    let Some(paths) = root.get("paths").and_then(Value::as_array) else {
        return base;
    };
    let digests = root.get("digests").and_then(Value::as_object);
    for path in paths.iter().filter_map(Value::as_str) {
        let digest = digests
            .and_then(|map| map.get(path))
            .and_then(Value::as_str)
            .unwrap_or("");
        let _ = base.insert(path.to_owned(), digest.to_owned());
    }
    base
}

/// The note bases in the manifest's `bases` (TS `readMirrorBases`), in manifest order. An entry
/// needs a string `bodyDigest` and a `fields` that is an object or an array (TS's
/// `typeof === "object"` accepts both); anything else is skipped. `fields` is kept as read, so
/// an array survives a manifest round trip. Absent, unparseable, or `bases`-less manifests give
/// an empty map.
#[must_use]
pub fn read_mirror_bases(text: Option<&str>) -> IndexMap<String, VaultPageBase> {
    let mut bases = IndexMap::new();
    let Some(root) = parse_manifest(text) else {
        return bases;
    };
    let Some(entries) = root.get("bases").and_then(Value::as_object) else {
        return bases;
    };
    for (path, value) in entries {
        let Some(entry) = value.as_object() else {
            continue;
        };
        let Some(body_digest) = entry.get("bodyDigest").and_then(Value::as_str) else {
            continue;
        };
        let fields = match entry.get("fields") {
            Some(fields @ (Value::Object(_) | Value::Array(_))) => fields.clone(),
            _ => continue,
        };
        let _ = bases.insert(
            path.clone(),
            VaultPageBase {
                fields,
                body_digest: body_digest.to_owned(),
            },
        );
    }
    bases
}

/// The digest map with `path` claimed for `stamped` text (TS `claimImportedFile`'s record step).
#[must_use]
pub fn claim_digest(
    base: &IndexMap<String, String>,
    path: &str,
    stamped: &str,
) -> IndexMap<String, String> {
    let mut next = base.clone();
    let _ = next.insert(path.to_owned(), digest_text(stamped));
    next
}

/// `path` after a project folder `old` moved to `root`: paths under `old/` move, others stay.
#[must_use]
pub fn moved_path(old: &str, root: &str, path: &str) -> String {
    match path.strip_prefix(old) {
        Some(rest) if rest.starts_with('/') => format!("{root}{rest}"),
        _ => path.to_owned(),
    }
}

/// The manifest text with `paths`, `digests` and `bases` re-keyed from `old` to `root`
/// (TS `followProjectRename`). Absent keys stay absent, non-string paths stay, and the output is
/// two-space JSON with a trailing newline. An array root has none of those keys, so it is
/// written back unchanged in that format, as the TS does. `None` when the text is neither a
/// JSON object nor an array.
#[must_use]
pub fn rekey_manifest_text(text: &str, old: &str, root: &str) -> Option<String> {
    let mut parsed: Value = serde_json::from_str(text).ok()?;
    if let Some(object) = parsed.as_object_mut() {
        rekey_object(object, old, root);
    } else if !parsed.is_array() {
        return None;
    }
    serde_json::to_string_pretty(&parsed)
        .ok()
        .map(|json| format!("{json}\n"))
}

fn rekey_object(object: &mut Map<String, Value>, old: &str, root: &str) {
    if let Some(paths) = object.get_mut("paths").and_then(Value::as_array_mut) {
        for path in paths.iter_mut() {
            if let Some(moved) = path.as_str().map(|p| moved_path(old, root, p)) {
                *path = Value::String(moved);
            }
        }
    }
    for key in ["digests", "bases"] {
        if let Some(value) = object.get_mut(key) {
            let rekeyed = value.as_object().map(|map| {
                map.iter()
                    .map(|(k, v)| (moved_path(old, root, k), v.clone()))
                    .collect::<Map<String, Value>>()
            });
            if let Some(rekeyed) = rekeyed {
                *value = Value::Object(rekeyed);
            }
        }
    }
}

#[cfg(test)]
mod manifest_tests {
    use super::*;

    const OLD: &str = "Projects/alpha--abc123";
    const ROOT: &str = "Projects/alpha-renamed--abc123";

    #[test]
    fn read_mirror_base_maps_paths_to_digests() {
        let text = r#"{"paths":["a.md","b.md"],"digests":{"a.md":"d1","b.md":"d2"}}"#;
        let base = read_mirror_base(Some(text));
        assert_eq!(base.get("a.md").map(String::as_str), Some("d1"));
        assert_eq!(base.get("b.md").map(String::as_str), Some("d2"));
        assert_eq!(base.len(), 2);
    }

    #[test]
    fn read_mirror_base_gives_empty_digest_for_missing_or_non_string() {
        // Path with no digest, and a path whose digest is not a string: both become "".
        let text = r#"{"paths":["a.md","b.md"],"digests":{"b.md":7}}"#;
        let base = read_mirror_base(Some(text));
        assert_eq!(base.get("a.md").map(String::as_str), Some(""));
        assert_eq!(base.get("b.md").map(String::as_str), Some(""));
    }

    #[test]
    fn read_mirror_base_gives_empty_digest_when_digests_not_object() {
        let text = r#"{"paths":["a.md"],"digests":["x"]}"#;
        let base = read_mirror_base(Some(text));
        assert_eq!(base.get("a.md").map(String::as_str), Some(""));
        let text = r#"{"paths":["a.md"],"digests":null}"#;
        assert_eq!(
            read_mirror_base(Some(text)).get("a.md").map(String::as_str),
            Some("")
        );
    }

    #[test]
    fn read_mirror_base_skips_non_string_paths() {
        let text = r#"{"paths":[1,"a.md",null],"digests":{"a.md":"d"}}"#;
        let base = read_mirror_base(Some(text));
        assert_eq!(base.len(), 1);
        assert_eq!(base.get("a.md").map(String::as_str), Some("d"));
    }

    #[test]
    fn read_mirror_base_empty_without_paths_array_or_on_error() {
        assert!(read_mirror_base(None).is_empty());
        assert!(read_mirror_base(Some("not json")).is_empty());
        assert!(read_mirror_base(Some("null")).is_empty());
        assert!(read_mirror_base(Some("3")).is_empty());
        assert!(read_mirror_base(Some(r#"{"digests":{"a.md":"d"}}"#)).is_empty());
        assert!(read_mirror_base(Some(r#"{"paths":"a.md"}"#)).is_empty());
    }

    #[test]
    fn read_mirror_bases_keeps_entries_with_digest_and_fields() {
        let text = r#"{"bases":{"n.md":{"bodyDigest":"bd","fields":{"title":"T"}}}}"#;
        let bases = read_mirror_bases(Some(text));
        let entry = bases.get("n.md").expect("n.md base");
        assert_eq!(entry.body_digest, "bd");
        assert_eq!(entry.fields.get("title"), Some(&Value::String("T".into())));
    }

    #[test]
    fn read_mirror_bases_skips_entries_missing_digest_or_fields() {
        let text = r#"{"bases":{
            "no-digest.md":{"fields":{}},
            "digest-not-string.md":{"bodyDigest":1,"fields":{}},
            "no-fields.md":{"bodyDigest":"bd"},
            "fields-null.md":{"bodyDigest":"bd","fields":null},
            "fields-string.md":{"bodyDigest":"bd","fields":"x"},
            "null-entry.md":null,
            "string-entry.md":"bd",
            "ok.md":{"bodyDigest":"bd","fields":{}}
        }}"#;
        let bases = read_mirror_bases(Some(text));
        assert_eq!(
            bases.keys().map(String::as_str).collect::<Vec<_>>(),
            vec!["ok.md"]
        );
    }

    #[test]
    fn read_mirror_bases_empty_for_older_or_broken_manifests() {
        assert!(read_mirror_bases(None).is_empty());
        assert!(read_mirror_bases(Some("{")).is_empty());
        assert!(read_mirror_bases(Some("null")).is_empty());
        assert!(read_mirror_bases(Some(r#"{"paths":["a.md"]}"#)).is_empty());
        assert!(read_mirror_bases(Some(r#"{"bases":null}"#)).is_empty());
        assert!(read_mirror_bases(Some(r#"{"bases":[]}"#)).is_empty());
    }

    #[test]
    fn claim_digest_inserts_digest_of_stamped_text() {
        let mut base = IndexMap::new();
        let _ = base.insert("a.md".into(), "old".into());
        let next = claim_digest(&base, "b.md", "stamped");
        assert_eq!(next.get("a.md").map(String::as_str), Some("old"));
        assert_eq!(
            next.get("b.md").map(String::as_str),
            Some(digest_text("stamped").as_str())
        );
        // The input is left alone.
        assert!(!base.contains_key("b.md"));
    }

    #[test]
    fn moved_path_moves_only_paths_under_old_folder() {
        assert_eq!(
            moved_path(OLD, ROOT, &format!("{OLD}/notes/a.md")),
            format!("{ROOT}/notes/a.md")
        );
        assert_eq!(
            moved_path(OLD, ROOT, &format!("{OLD}/a.md")),
            format!("{ROOT}/a.md")
        );
        // A sibling that only shares the prefix is not under the folder.
        assert_eq!(
            moved_path(OLD, ROOT, &format!("{OLD}-copy/a.md")),
            format!("{OLD}-copy/a.md")
        );
        assert_eq!(moved_path(OLD, ROOT, "Other/a.md"), "Other/a.md");
    }

    #[test]
    fn rekey_manifest_text_moves_paths_digests_and_bases() {
        let text = format!(
            r#"{{"paths":["{OLD}/a.md","keep.md",3],"digests":{{"{OLD}/a.md":"d"}},"bases":{{"{OLD}/a.md":{{"bodyDigest":"bd","fields":{{}}}}}}}}"#
        );
        let out = rekey_manifest_text(&text, OLD, ROOT).expect("object manifest rekeys");
        let parsed: Value = serde_json::from_str(&out).expect("output is JSON");
        assert_eq!(
            parsed["paths"],
            serde_json::json!([format!("{ROOT}/a.md"), "keep.md", 3])
        );
        assert_eq!(parsed["digests"][format!("{ROOT}/a.md")], "d");
        assert_eq!(parsed["bases"][format!("{ROOT}/a.md")]["bodyDigest"], "bd");
        assert!(out.ends_with("}\n"));
        assert!(out.contains("\n  \"paths\""), "two-space indent: {out}");
    }

    #[test]
    fn rekey_manifest_text_keeps_absent_keys_absent() {
        let out = rekey_manifest_text(r#"{"paths":[]}"#, OLD, ROOT).expect("rekeys");
        let parsed: Value = serde_json::from_str(&out).expect("output is JSON");
        assert!(parsed.get("digests").is_none());
        assert!(parsed.get("bases").is_none());
    }

    #[test]
    fn rekey_manifest_text_keeps_null_digests() {
        let out = rekey_manifest_text(r#"{"digests":null}"#, OLD, ROOT).expect("rekeys");
        let parsed: Value = serde_json::from_str(&out).expect("output is JSON");
        assert_eq!(parsed["digests"], Value::Null);
    }

    #[test]
    fn rekey_manifest_text_none_for_scalar_or_unparseable() {
        assert_eq!(rekey_manifest_text("not json", OLD, ROOT), None);
        assert_eq!(rekey_manifest_text("null", OLD, ROOT), None);
        assert_eq!(rekey_manifest_text("3", OLD, ROOT), None);
    }

    #[test]
    fn rekey_manifest_text_writes_an_array_root_back() {
        // Parity point (f): an array root is written back, not dropped to None.
        let out =
            rekey_manifest_text(r#"["a","b"]"#, OLD, ROOT).expect("array root is written back");
        let parsed: Value = serde_json::from_str(&out).expect("output is JSON");
        assert_eq!(parsed, serde_json::json!(["a", "b"]));
        assert!(out.ends_with("]\n"));
    }

    #[test]
    fn read_mirror_bases_accepts_array_fields_and_keeps_them() {
        // Parity point (b): TS `typeof fields === "object"` accepts arrays; the array is kept as read.
        let text = r#"{"bases":{"n.md":{"bodyDigest":"bd","fields":["x"]},"m.md":{"bodyDigest":"bm","fields":null},"k.md":{"fields":{}}}}"#;
        let bases = read_mirror_bases(Some(text));
        assert_eq!(bases.len(), 1);
        let base = bases.get("n.md").expect("array-fields entry is kept");
        assert_eq!(base.body_digest, "bd");
        assert_eq!(base.fields, serde_json::json!(["x"]));
    }

    #[test]
    fn read_mirror_bases_keeps_manifest_order() {
        // Parity point (c): insertion order is the manifest's, not sorted.
        let text = r#"{"bases":{"z.md":{"bodyDigest":"1","fields":{}},"a.md":{"bodyDigest":"2","fields":{}},"m.md":{"bodyDigest":"3","fields":{}}}}"#;
        let bases = read_mirror_bases(Some(text));
        let keys: Vec<&str> = bases.keys().map(String::as_str).collect();
        assert_eq!(keys, vec!["z.md", "a.md", "m.md"]);
    }
}

/// What [`mirror_workspace`] would do, without touching a folder: the caller has read
/// the folder's text into `disk` (path -> text; a missing key is a missing file) for every
/// path in `files`, and for every previous path that is not present but has a `base`
/// entry. Assets are not fetched or written; their folder paths only count as present,
/// so they are never removed. `written` and `removed` are the writes and removals to apply.
///
/// # Errors
///
/// None in practice: the plan's file system never fails. The `Result` keeps the shared
/// mirror steps unchanged.
pub fn plan_mirror(
    files: &[(String, String)],
    asset_paths: &[String],
    previous_paths: &[String],
    base: Option<&HashMap<String, String>>,
    disk: &HashMap<String, String>,
) -> Result<MirrorResult, FsError> {
    let mut fs = PlanFs { disk };
    let mut run = Run {
        fs: &mut fs,
        base,
        result: MirrorResult::default(),
        held: HashSet::new(),
    };
    for (path, content) in files {
        run.mirror_file(path, content)?;
    }
    let present: HashSet<&str> = files
        .iter()
        .map(|(path, _)| path.as_str())
        .chain(asset_paths.iter().map(String::as_str))
        .collect();
    run.remove_departed(previous_paths, &present);
    Ok(run.result)
}

/// A read-only view of text the caller already read; writes succeed and change nothing.
struct PlanFs<'a> {
    disk: &'a HashMap<String, String>,
}

impl WorkspaceFs for PlanFs<'_> {
    fn read_file(&self, path: &str) -> Result<Vec<u8>, FsError> {
        self.read_text(path).map(String::into_bytes)
    }

    fn read_text(&self, path: &str) -> Result<String, FsError> {
        self.disk
            .get(path)
            .cloned()
            .ok_or_else(|| FsError::NotFound(path.to_owned()))
    }

    fn write_file(&mut self, _path: &str, _data: &[u8]) -> Result<(), FsError> {
        Ok(())
    }

    fn remove(&mut self, _path: &str, _recursive: bool) -> Result<(), FsError> {
        Ok(())
    }

    fn mkdirp(&mut self, _path: &str) -> Result<(), FsError> {
        Ok(())
    }

    fn list(&self, _dir: &str) -> Result<Vec<WorkspaceStat>, FsError> {
        Ok(Vec::new())
    }

    fn walk(&self, _dir: &str) -> Result<Vec<WorkspaceStat>, FsError> {
        Ok(Vec::new())
    }

    fn stat(&self, _path: &str) -> Option<WorkspaceStat> {
        None
    }

    fn rename(&mut self, _from: &str, _to: &str) -> Result<(), FsError> {
        Ok(())
    }
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

/// The text the folder compares, with the export time of a README or manifest blanked. Two texts
/// that differ only in that time compare equal; any other path comes back unchanged.
#[must_use]
pub fn unstamp_for_compare(path: &str, text: &str) -> String {
    unstamped(path, text).into_owned()
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

#[cfg(test)]
mod unstamp_tests {
    use super::*;

    #[test]
    fn a_readme_export_time_does_not_count_as_a_change() {
        let before = unstamp_for_compare("README.md", "# Notes\nExported 2026-01-01.\n");
        let after = unstamp_for_compare("README.md", "# Notes\nExported 2026-02-02.\n");
        assert_eq!(before, after);
        assert_eq!(before, "# Notes\nExported\n");
    }

    #[test]
    fn a_manifest_generated_at_does_not_count_as_a_change() {
        let path = "Projects/a/manifest.json";
        let old = "{\n  \"generatedAt\": \"2026-01-01T00:00:00.000Z\"\n}\n";
        let new = "{\n  \"generatedAt\": \"2026-02-02T00:00:00.000Z\"\n}\n";
        let before = unstamp_for_compare(path, old);
        let after = unstamp_for_compare(path, new);
        assert_eq!(before, after);
        assert_eq!(before, "{\n  \"generatedAt\": \n}\n");
    }

    #[test]
    fn other_paths_are_compared_as_they_are() {
        let text = "Exported 2026-01-01.\n\"generatedAt\": \"x\"";
        assert_eq!(unstamp_for_compare("notes/a.md", text), text);
    }

    #[test]
    fn a_line_without_a_closing_quote_keeps_its_value() {
        let text = "  \"generatedAt\": \"open";
        assert_eq!(unstamp_for_compare("manifest.json", text), text);
    }
}
