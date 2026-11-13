//! Sync and workspace rules for JavaScript (step 0b-2). Each export wraps a
//! `wf-core` function; the JS shapes match `packages/core/src/workspace`.

use serde::{Deserialize, Serialize};
use std::fmt::Display;

use wasm_bindgen::JsError;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
// digest_text stays out: the web hashes in TS, which matches the digests
// other TS code writes (lone surrogates included) and has no input limit.
use wf_core::sync::change_origin::{ChangeOrigin, changed_side, digest_text};
use wf_core::sync::git_policy::{
    FileState, GitSyncDecision, GitSyncSkipReason, decide_git_sync_path, describe_changes,
    is_under_ignored_folder,
};
// check_git_remote_url is bound below: the TS copy is gone, so the url crate's ~88 KB gzipped is the cost.
use wf_core::sync::git_gate::{GitAction, GitVerdict, VaultRepoState, decide_vault_commit};
use wf_core::sync::git_remote::{
    GitPullResult, GitPushResult, RemoteStatus, describe_pull, describe_push, describe_status,
    redact_secret,
};
use wf_core::sync::snapshot_delta::{EntityStamp, apply_delta, plan_delta};
use wf_core::sync::stamp_workspace_id::stamp_workspace_id;
use wf_core::workspace::archive_limits::{self as archive, ArchiveLimits, EntryInfo};
use wf_core::workspace::{is_safe_workspace_path, safe_workspace_path};

use super::{check_text, to_js};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// `{ include: true }` or `{ include: false, reason }`, as the TS returns it.
#[derive(Serialize)]
struct Decision {
    include: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<GitSyncSkipReason>,
}

/// [`wf_core::sync::change_origin::changed_side`] for JS, as a `ChangeSide` string.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = changedSide)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
pub fn changed_side_js(
    base: Option<String>,
    folder: Option<String>,
    workspace: Option<String>,
) -> JsResult<JsValue> {
    to_js(&changed_side(ChangeOrigin {
        base: base.as_deref(),
        folder: folder.as_deref(),
        workspace: workspace.as_deref(),
    }))
}

/// [`wf_core::sync::change_origin::digest_text`] for JS.
#[wasm_bindgen(js_name = digestText)]
#[must_use]
pub fn digest_text_js(text: &str) -> String {
    digest_text(text)
}

/// [`wf_core::sync::git_policy::is_under_ignored_folder`] for JS.
///
/// # Errors
///
/// Fails when `rel_path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = isUnderIgnoredFolder)]
pub fn is_under_ignored_folder_js(rel_path: js_sys::JsString) -> JsResult<bool> {
    let rel_path = &crate::guarded_text(&rel_path)?;
    Ok(is_under_ignored_folder(rel_path))
}

/// [`wf_core::sync::git_policy::decide_git_sync_path`] for JS, as `{ include, reason? }`.
///
/// # Errors
///
/// Fails when `rel_path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or the
/// decision cannot be converted to a JS value.
#[wasm_bindgen(js_name = decideGitSyncPath)]
pub fn decide_git_sync_path_js(
    rel_path: js_sys::JsString,
    size_bytes: f64,
    max_file_bytes: f64,
) -> JsResult<JsValue> {
    let rel_path = &crate::guarded_text(&rel_path)?;
    let decision = match decide_git_sync_path(rel_path, size_bytes, max_file_bytes) {
        GitSyncDecision::Include => Decision {
            include: true,
            reason: None,
        },
        GitSyncDecision::Skip(reason) => Decision {
            include: false,
            reason: Some(reason),
        },
    };
    to_js(&decision)
}

/// One row of `describeChanges`'s input. Only `state` is read; other fields of a `GitFileStatus` are ignored.
#[derive(Deserialize)]
struct FileStatusIn {
    state: FileState,
}

/// [`wf_core::sync::git_policy::describe_changes`] for JS, from `[{ state: "added" | "modified" | "deleted" }]`.
///
/// # Errors
///
/// Fails when `status` is not that shape.
#[wasm_bindgen(js_name = describeChanges)]
pub fn describe_changes_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly { state: \"added\" | \"modified\" | \"deleted\" }[]"
    )]
    status: JsValue,
) -> JsResult<String> {
    let rows: Vec<FileStatusIn> = serde_wasm_bindgen::from_value(status)?;
    let states: Vec<FileState> = rows.iter().map(|row| row.state).collect();
    Ok(describe_changes(&states))
}

/// `VaultRepoState` as the TS sends it: `{ kind: "none" | "own" | "enclosing", root? }`.
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum RepoStateIn {
    None,
    Own,
    Enclosing { root: String },
}

/// `GitVerdict` as the TS returns it: `{ ok: true, action }` or `{ ok: false, reason }`.
#[derive(Serialize)]
struct VerdictOut {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    action: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

/// [`wf_core::sync::git_gate::decide_vault_commit`] for JS, as `{ ok, action? | reason? }`.
///
/// # Errors
///
/// Fails when `state` is not a valid repo state, or the verdict cannot be converted to a JS value.
#[wasm_bindgen(js_name = decideVaultCommit)]
pub fn decide_vault_commit_js(enabled: bool, state: JsValue) -> JsResult<JsValue> {
    let state: RepoStateIn = serde_wasm_bindgen::from_value(state)?;
    let state = match state {
        RepoStateIn::None => VaultRepoState::None,
        RepoStateIn::Own => VaultRepoState::Own,
        RepoStateIn::Enclosing { root } => VaultRepoState::Enclosing { root },
    };
    let out = match decide_vault_commit(enabled, &state) {
        GitVerdict::Allowed(action) => VerdictOut {
            ok: true,
            action: Some(match action {
                GitAction::Init => "init",
                GitAction::Commit => "commit",
            }),
            reason: None,
        },
        GitVerdict::Refused { reason } => VerdictOut {
            ok: false,
            action: None,
            reason: Some(reason),
        },
    };
    to_js(&out)
}

/// [`wf_core::sync::git_remote::redact_secret`] for JS.
///
/// # Errors
///
/// Fails when `text` or `secret` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = redactSecret)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
pub fn redact_secret_js(text: &str, secret: Option<String>) -> JsResult<String> {
    check_text(text)?;
    if let Some(secret) = secret.as_deref() {
        check_text(secret)?;
    }
    Ok(redact_secret(text, secret.as_deref()))
}

/// [`wf_core::sync::git_remote::describe_pull`] for JS.
///
/// # Errors
///
/// Fails when `result` is not a valid `GitPullResult` object.
#[wasm_bindgen(js_name = describePull)]
pub fn describe_pull_js(
    #[wasm_bindgen(unchecked_param_type = "B.GitPullResult")] result: JsValue,
) -> JsResult<String> {
    let result: GitPullResult = serde_wasm_bindgen::from_value(result)?;
    Ok(describe_pull(&result))
}

/// [`wf_core::sync::git_remote::describe_push`] for JS.
///
/// # Errors
///
/// Fails when `result` is not a valid `GitPushResult` object.
#[wasm_bindgen(js_name = describePush)]
pub fn describe_push_js(
    #[wasm_bindgen(unchecked_param_type = "B.GitPushResult")] result: JsValue,
) -> JsResult<String> {
    let result: GitPushResult = serde_wasm_bindgen::from_value(result)?;
    Ok(describe_push(&result))
}

/// [`wf_core::sync::git_remote::describe_status`] for JS.
///
/// # Errors
///
/// Fails when `status` is not a valid `{ url, branch, ahead, behind }` object.
#[wasm_bindgen(js_name = describeRemoteStatus)]
pub fn describe_remote_status_js(
    #[wasm_bindgen(unchecked_param_type = "B.RemoteStatusInput")] status: JsValue,
) -> JsResult<String> {
    let status: RemoteStatus = serde_wasm_bindgen::from_value(status)?;
    Ok(describe_status(&status))
}

/// A `{ id, updatedAt }` entry from the database's stamp listing.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StampIn {
    id: String,
    updated_at: String,
}

/// [`wf_core::sync::snapshot_delta::DeltaPlan`] as `{ fetch, drop, unchanged }`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanOut {
    fetch: Vec<String>,
    drop: Vec<String>,
    unchanged: bool,
}

/// [`wf_core::sync::snapshot_delta::plan_delta`] for JS. `remote` is `{ id, updatedAt }[]`
/// and `held` is `[id, stamp][]`, as the TS shell passes them.
///
/// # Errors
///
/// Fails when either argument does not have the expected shape.
#[wasm_bindgen(js_name = planDelta)]
pub fn plan_delta_js(remote: JsValue, held: JsValue) -> JsResult<JsValue> {
    let remote: Vec<StampIn> = serde_wasm_bindgen::from_value(remote)?;
    let held: Vec<(String, String)> = serde_wasm_bindgen::from_value(held)?;
    let remote: Vec<EntityStamp> = remote
        .into_iter()
        .map(|s| EntityStamp {
            id: s.id,
            updated_at: s.updated_at,
        })
        .collect();
    let plan = plan_delta(&remote, &held);
    to_js(&PlanOut {
        fetch: plan.fetch,
        drop: plan.drop,
        unchanged: plan.unchanged,
    })
}

/// [`wf_core::sync::snapshot_delta::apply_delta`] for JS over rows that carry an `id`.
/// `order` is `{ id, updatedAt }[]`; the result follows it.
///
/// # Errors
///
/// Fails when an argument does not have the expected shape.
#[wasm_bindgen(js_name = applyDelta)]
pub fn apply_delta_js(held: JsValue, fetched: JsValue, order: JsValue) -> JsResult<JsValue> {
    let held: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(held)?;
    let fetched: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(fetched)?;
    let order: Vec<StampIn> = serde_wasm_bindgen::from_value(order)?;
    let order: Vec<EntityStamp> = order
        .into_iter()
        .map(|s| EntityStamp {
            id: s.id,
            updated_at: s.updated_at,
        })
        .collect();
    let merged = apply_delta(&held, &fetched, &order, |row| {
        row.get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
    });
    to_js(&merged)
}

/// [`wf_core::sync::stamp_workspace_id::stamp_workspace_id`] for JS; `null` when already stamped.
///
/// # Errors
///
/// Fails when `content` or `id` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = stampWorkspaceId, unchecked_return_type = "string | null")]
pub fn stamp_workspace_id_js(content: js_sys::JsString, id: js_sys::JsString) -> JsResult<JsValue> {
    let content = &crate::guarded_text(&content)?;
    let id = &crate::guarded_text(&id)?;
    Ok(stamp_workspace_id(content, id).map_or(JsValue::NULL, JsValue::from))
}

/// [`wf_core::workspace::safe_workspace_path`] for JS.
///
/// # Errors
///
/// Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when the
/// path could leave the workspace root (`Unsafe workspace path: <path>`).
#[wasm_bindgen(js_name = safeWorkspacePath)]
pub fn safe_workspace_path_js(path: js_sys::JsString) -> JsResult<String> {
    let path = &crate::guarded_text(&path)?;
    safe_workspace_path(path).map_err(|e| serde_wasm_bindgen::Error::new(e.to_string()))
}

/// [`wf_core::workspace::is_safe_workspace_path`] for JS.
///
/// # Errors
///
/// Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = isSafeWorkspacePath)]
pub fn is_safe_workspace_path_js(path: js_sys::JsString) -> JsResult<bool> {
    let path = &crate::guarded_text(&path)?;
    Ok(is_safe_workspace_path(path))
}

/// [`slug_for`](wf_core::sync::folder_layout::slug_for); `fallback` defaults to
/// `"untitled"` (TS `slugFor`).
#[wasm_bindgen(js_name = slugFor)]
#[must_use]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
pub fn slug_for_js(title: &str, fallback: Option<String>) -> String {
    wf_core::sync::folder_layout::slug_for(title, fallback.as_deref().unwrap_or("untitled"))
}

/// A tree node as the TS `FolderNode` spells it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsFolderNode {
    id: String,
    title: String,
    #[serde(default)]
    parent_id: Option<String>,
}

/// [`tree_paths`](wf_core::sync::folder_layout::tree_paths) as `(id, path)` pairs in first-seen
/// order; `project_root` defaults to empty.
fn tree_path_rows(
    nodes: JsValue,
    entity: JsValue,
    project_root: Option<&str>,
) -> JsResult<Vec<(String, String)>> {
    use wf_core::sync::folder_layout::{FolderNode, WorkspaceEntityType, tree_paths};
    let nodes: Vec<JsFolderNode> = serde_wasm_bindgen::from_value(nodes)?;
    let entity: WorkspaceEntityType = serde_wasm_bindgen::from_value(entity)?;
    let nodes: Vec<FolderNode> = nodes
        .into_iter()
        .map(|n| FolderNode {
            id: n.id,
            title: n.title,
            parent_id: n.parent_id,
        })
        .collect();
    Ok(tree_paths(&nodes, entity, project_root.unwrap_or_default()))
}

/// [`tree_paths`](wf_core::sync::folder_layout::tree_paths) as `[id, path]` pairs in
/// first-seen order.
///
/// # Errors
///
/// Fails if `nodes` is not an array of `FolderNode`s or `entity` is not a known type.
#[wasm_bindgen(js_name = treePathPairs, unchecked_return_type = "[string, string][]")]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
pub fn tree_path_pairs_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly { id: string; title: string; parentId?: string | null }[]"
    )]
    nodes: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.WorkspaceEntityType")] entity: JsValue,
    project_root: Option<String>,
) -> JsResult<JsValue> {
    to_js(&tree_path_rows(nodes, entity, project_root.as_deref())?)
}

/// [`tree_paths`](wf_core::sync::folder_layout::tree_paths): the folder path of each node in a
/// tree, keyed by id, as a `Map` in first-seen order.
///
/// # Errors
///
/// Fails if `nodes` is not an array of `FolderNode`s or `entity` is not a known type.
#[wasm_bindgen(js_name = treePaths, unchecked_return_type = "Map<string, string>")]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
pub fn tree_paths_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly { id: string; title: string; parentId?: string | null }[]"
    )]
    nodes: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.WorkspaceEntityType")] entity: JsValue,
    project_root: Option<String>,
) -> JsResult<JsValue> {
    let map = js_sys::Map::new();
    for (id, path) in tree_path_rows(nodes, entity, project_root.as_deref())? {
        let _ = map.set(&JsValue::from_str(&id), &JsValue::from_str(&path));
    }
    Ok(map.into())
}

/// `{ ok: true, url }` or `{ ok: false, reason }`, as the TS returns it.
#[derive(Serialize)]
struct UrlCheck {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

/// [`check_git_remote_url`](wf_core::sync::git_remote::check_git_remote_url); a
/// non-string `raw` is refused (TS `checkGitRemoteUrl`).
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[wasm_bindgen(
    js_name = checkGitRemoteUrl,
    unchecked_return_type = "{ ok: true; url: string } | { ok: false; reason: string }"
)]
pub fn check_git_remote_url_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] raw: &JsValue,
) -> JsResult<JsValue> {
    use wf_core::sync::git_remote::{GitRemoteUrlCheck, check_git_remote_url};
    let check = match check_git_remote_url(raw.as_string().as_deref()) {
        GitRemoteUrlCheck::Accepted { url } => UrlCheck {
            ok: true,
            url: Some(url),
            reason: None,
        },
        GitRemoteUrlCheck::Refused { reason } => UrlCheck {
            ok: false,
            url: None,
            reason: Some(reason),
        },
    };
    to_js(&check)
}

/// [`read_ink_note_meta`](wf_core::sync::ink_note::read_ink_note_meta) of a frontmatter
/// object (TS `readInkNoteMeta`).
///
/// # Errors
///
/// Fails if `frontmatter` is not a plain object.
#[wasm_bindgen(js_name = readInkNoteMeta, unchecked_return_type = "B.InkNoteMeta")]
pub fn read_ink_note_meta_js(
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, unknown>>")]
    frontmatter: JsValue,
) -> JsResult<JsValue> {
    let fm: serde_json::Map<String, serde_json::Value> =
        serde_wasm_bindgen::from_value(frontmatter)?;
    to_js(&wf_core::sync::ink_note::read_ink_note_meta(&fm))
}

/// [`split_ink_text_layer`](wf_core::sync::ink_note::split_ink_text_layer): one string per
/// page (TS `splitInkTextLayer`).
///
/// # Errors
///
/// Fails if `body` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = splitInkTextLayer, unchecked_return_type = "string[]")]
pub fn split_ink_text_layer_js(body: &str) -> JsResult<JsValue> {
    check_text(body)?;
    to_js(&wf_core::sync::ink_note::split_ink_text_layer(body))
}

fn js_error(error: impl Display) -> JsError {
    JsError::new(&error.to_string())
}

/// [`ArchiveBudget`](archive::ArchiveBudget): the caps an import is held to, checked as
/// entries are inflated. `limits` is `{ maxTotalBytes, maxFileBytes, maxEntries }`.
#[wasm_bindgen]
pub struct ArchiveBudget {
    inner: archive::ArchiveBudget,
}

#[wasm_bindgen]
impl ArchiveBudget {
    /// # Errors
    ///
    /// Fails if `limits` has the wrong shape.
    #[wasm_bindgen(constructor)]
    pub fn new(limits: JsValue) -> Result<ArchiveBudget, JsError> {
        let limits: ArchiveLimits = serde_wasm_bindgen::from_value(limits).map_err(js_error)?;
        Ok(Self {
            inner: archive::ArchiveBudget::new(limits),
        })
    }

    /// [`admit`](archive::ArchiveBudget::admit). `original_size` is a JS number; the
    /// cast saturates, so a huge declared size is refused rather than wrapped.
    ///
    /// # Errors
    ///
    /// Throws past the entry count or the total cap.
    pub fn admit(&mut self, name: &str, original_size: f64) -> Result<bool, JsError> {
        // A file size from JS: whole, non-negative, far below 2^53.
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let size = original_size.max(0.0).round() as u64;
        self.inner
            .admit(name, size)
            .map_err(|message| JsError::new(&message))
    }

    /// Names refused as over the file cap, in archive order.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn oversize(&self) -> Vec<String> {
        self.inner.oversize().to_vec()
    }
}

/// [`plan_entries`](archive::plan_entries). `entries` is `{ name, size }[]` in archive order;
/// the result is `{ name, action }[]` in the same order, where `action` is `keep`,
/// `empty`, `unsafe-name` or `too-big`.
///
/// # Errors
///
/// Fails if an argument has the wrong shape, or past the entry count or the total cap.
#[wasm_bindgen(js_name = planArchiveEntries, unchecked_return_type = "B.PlannedEntry[]")]
pub fn plan_archive_entries_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.EntryInfo[]")] entries: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.ArchiveLimits")] limits: JsValue,
) -> Result<JsValue, JsError> {
    let entries: Vec<EntryInfo> = serde_wasm_bindgen::from_value(entries).map_err(js_error)?;
    let limits: ArchiveLimits = serde_wasm_bindgen::from_value(limits).map_err(js_error)?;
    let plan =
        archive::plan_entries(&entries, &limits).map_err(|message| JsError::new(&message))?;
    to_js(&plan).map_err(js_error)
}

/// [`strip_archive_root`](archive::strip_archive_root). `paths` is a `string[]`.
///
/// # Errors
///
/// Fails if `paths` has the wrong shape.
#[wasm_bindgen(js_name = stripArchiveRoot, unchecked_return_type = "string[]")]
pub fn strip_archive_root_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] paths: JsValue,
) -> Result<JsValue, JsError> {
    let paths: Vec<String> = serde_wasm_bindgen::from_value(paths).map_err(js_error)?;
    to_js(&archive::strip_archive_root(&paths)).map_err(js_error)
}
