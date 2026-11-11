//! Git repo web links for JavaScript (wf-core `sync::repo_web_url`). The JS names
//! match `apps/web/src/features/sync/infrastructure/parts.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::repo_web_url;

/// [`repo_web_url`](repo_web_url::repo_web_url): the trimmed repo URL when it is
/// http(s), otherwise `undefined`.
#[wasm_bindgen(js_name = repoWebUrl)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn repo_web_url_js(repo_url: Option<String>) -> Option<String> {
    repo_web_url::repo_web_url(repo_url.as_deref())
}

/// [`commit_url`](repo_web_url::commit_url): a commit's web URL, or `undefined`.
#[wasm_bindgen(js_name = commitUrl)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn commit_url_js(repo_url: Option<String>, sha: Option<String>) -> Option<String> {
    repo_web_url::commit_url(repo_url.as_deref(), sha.as_deref())
}
