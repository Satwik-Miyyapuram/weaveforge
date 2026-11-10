//! Partial-refresh planning for the search index (wf-core `refresh_diff`). The
//! JS name matches `packages/wf-wasm/src/search-refresh-diff.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::refresh_diff::{self, PrintEntry};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`diff_refresh`](refresh_diff::diff_refresh) as `{remove, add, prints}`.
///
/// # Errors
///
/// Fails if `prints` or `fresh` is not an array of `{id, print}` records, or
/// `held` is not an array of strings.
#[wasm_bindgen(js_name = diffRefreshPlan)]
pub fn diff_refresh_plan_js(prints: JsValue, held: JsValue, fresh: JsValue) -> JsResult<JsValue> {
    let prints: Vec<PrintEntry> = serde_wasm_bindgen::from_value(prints)?;
    let held: Vec<String> = serde_wasm_bindgen::from_value(held)?;
    let fresh: Vec<PrintEntry> = serde_wasm_bindgen::from_value(fresh)?;
    to_js(&refresh_diff::diff_refresh(&prints, &held, &fresh))
}
