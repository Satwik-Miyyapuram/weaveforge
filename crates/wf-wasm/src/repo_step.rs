//! wasm export for `repo_query` (TS: `rustRepository` in `backend/providers/postgrest/rust-repository.ts`).

use serde_json::Value;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::repo_query::{self, RepoCall, RepoCtx};

use super::to_js;

/// [`repo_query::repo_step`]: what `repo.method` does next, given its arguments and the
/// replies to the queries it already sent.
///
/// # Errors
///
/// Fails if `args` or `replies` is not an array, `ctx` is not a `RepoCtx`, or the step cannot
/// be converted to JS.
#[wasm_bindgen(js_name = repoStep, unchecked_return_type = "B.RepoStep")]
pub fn repo_step_js(
    repo: &str,
    method: &str,
    #[wasm_bindgen(unchecked_param_type = "unknown[]")] args: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.RepoCtx")] ctx: JsValue,
    #[wasm_bindgen(unchecked_param_type = "unknown[]")] replies: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let call = RepoCall {
        args: serde_wasm_bindgen::from_value::<Vec<Value>>(args)?,
        ctx: serde_wasm_bindgen::from_value::<RepoCtx>(ctx)?,
        replies: serde_wasm_bindgen::from_value::<Vec<Value>>(replies)?,
    };
    to_js(&repo_query::repo_step(repo, method, &call))
}
