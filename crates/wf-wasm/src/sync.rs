//! Sync and workspace rules for JavaScript (step 0b-2). Each export wraps a
//! `wf-core` function; the JS shapes match `packages/core/src/workspace`.

use serde::Serialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
// digest_text stays out: the web hashes in TS, which matches the digests
// other TS code writes (lone surrogates included) and has no input limit.
use wf_core::sync::change_origin::{ChangeOrigin, changed_side};
use wf_core::sync::git_policy::{
    GitSyncDecision, GitSyncSkipReason, decide_git_sync_path, is_under_ignored_folder,
};
// check_git_remote_url stays out: the url crate adds ~88 KB gzipped, and the browser has URL.
use wf_core::sync::git_remote::{GitPullResult, GitPushResult, describe_pull, describe_push};
use wf_core::sync::stamp_workspace_id::stamp_workspace_id;
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

/// [`wf_core::sync::git_policy::is_under_ignored_folder`] for JS.
///
/// # Errors
///
/// Fails when `rel_path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = isUnderIgnoredFolder)]
pub fn is_under_ignored_folder_js(rel_path: &str) -> JsResult<bool> {
    check_text(rel_path)?;
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
    rel_path: &str,
    size_bytes: f64,
    max_file_bytes: f64,
) -> JsResult<JsValue> {
    check_text(rel_path)?;
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

/// [`wf_core::sync::git_remote::describe_pull`] for JS.
///
/// # Errors
///
/// Fails when `result` is not a valid `GitPullResult` object.
#[wasm_bindgen(js_name = describePull)]
pub fn describe_pull_js(result: JsValue) -> JsResult<String> {
    let result: GitPullResult = serde_wasm_bindgen::from_value(result)?;
    Ok(describe_pull(&result))
}

/// [`wf_core::sync::git_remote::describe_push`] for JS.
///
/// # Errors
///
/// Fails when `result` is not a valid `GitPushResult` object.
#[wasm_bindgen(js_name = describePush)]
pub fn describe_push_js(result: JsValue) -> JsResult<String> {
    let result: GitPushResult = serde_wasm_bindgen::from_value(result)?;
    Ok(describe_push(&result))
}

/// [`wf_core::sync::stamp_workspace_id::stamp_workspace_id`] for JS; `null` when already stamped.
///
/// # Errors
///
/// Fails when `content` or `id` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = stampWorkspaceId)]
pub fn stamp_workspace_id_js(content: &str, id: &str) -> JsResult<Option<String>> {
    check_text(content)?;
    check_text(id)?;
    Ok(stamp_workspace_id(content, id))
}

/// [`wf_core::workspace::safe_workspace_path`] for JS.
///
/// # Errors
///
/// Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when the
/// path could leave the workspace root (`Unsafe workspace path: <path>`).
#[wasm_bindgen(js_name = safeWorkspacePath)]
pub fn safe_workspace_path_js(path: &str) -> JsResult<String> {
    check_text(path)?;
    safe_workspace_path(path).map_err(|e| serde_wasm_bindgen::Error::new(e.to_string()))
}

/// [`wf_core::workspace::is_safe_workspace_path`] for JS.
///
/// # Errors
///
/// Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = isSafeWorkspacePath)]
pub fn is_safe_workspace_path_js(path: &str) -> JsResult<bool> {
    check_text(path)?;
    Ok(is_safe_workspace_path(path))
}
