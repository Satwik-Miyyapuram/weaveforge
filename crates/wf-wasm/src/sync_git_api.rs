//! The git read rules for JavaScript (wf-core `sync::git_api`). The JS names `gitReadPlan`,
//! `githubCommits`, `gitlabCommits` and `gitReadFailureMessage` are wrapped by
//! `packages/wf-wasm/src/sync-git-api.ts`, which `features/sync/infrastructure/git-client.ts`
//! calls.

use serde_wasm_bindgen::Error;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::git_api::{
    GhCommit, GitReadInput, GlCommit, git_read_failure_message, git_read_plan, github_commits,
    gitlab_commits,
};

use super::to_js;

type JsResult<T> = Result<T, Error>;

/// [`git_read_plan`] for JS (TS `gitReadPlan`).
///
/// # Errors
///
/// Fails when `input` is not a git read input with the expected fields.
#[wasm_bindgen(js_name = gitReadPlan)]
pub fn git_read_plan_js(input: JsValue) -> JsResult<JsValue> {
    let input: GitReadInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&git_read_plan(&input))
}

/// [`github_commits`] for JS (TS `githubCommits`).
///
/// # Errors
///
/// Fails when `items` is not a list of GitHub commits with the expected fields.
#[wasm_bindgen(js_name = githubCommits)]
pub fn github_commits_js(items: JsValue) -> JsResult<JsValue> {
    let items: Vec<GhCommit> = serde_wasm_bindgen::from_value(items)?;
    to_js(&github_commits(&items))
}

/// [`gitlab_commits`] for JS (TS `gitlabCommits`).
///
/// # Errors
///
/// Fails when `items` is not a list of GitLab commits with the expected fields.
#[wasm_bindgen(js_name = gitlabCommits)]
pub fn gitlab_commits_js(items: JsValue) -> JsResult<JsValue> {
    let items: Vec<GlCommit> = serde_wasm_bindgen::from_value(items)?;
    to_js(&gitlab_commits(&items))
}

/// [`git_read_failure_message`] for JS (TS `gitReadFailureMessage`).
#[wasm_bindgen(js_name = gitReadFailureMessage)]
#[must_use]
pub fn git_read_failure_message_js(status: u16, body: &str) -> String {
    git_read_failure_message(status, body)
}
