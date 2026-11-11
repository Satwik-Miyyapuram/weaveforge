//! GitHub repo PDF path for JavaScript (wf-core `reader::github_repo_path`). The JS name
//! matches `GitHubRepoPdfResolver` in `packages/core/src/reader/github-repo-pdf-resolver.ts`.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::reader::github_repo_path::github_repo_pdf_path;

/// [`github_repo_pdf_path`] (TS `githubRepoPdfPath`): the repo-relative PDF path, or null.
#[wasm_bindgen(js_name = githubRepoPdfPath, unchecked_return_type = "string | null")]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn github_repo_pdf_path_js(given_pdf_path: Option<String>, paper_id: &str) -> JsValue {
    github_repo_pdf_path(given_pdf_path.as_deref(), paper_id).map_or(JsValue::NULL, JsValue::from)
}
