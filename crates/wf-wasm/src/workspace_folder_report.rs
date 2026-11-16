//! Folder change triage for JavaScript (wf-core `workspace::folder_report`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::workspace::folder_report::{self, TriageInput};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`triage_reported_paths`](folder_report::triage_reported_paths) on `{ paths, projectId }`,
/// returning `{ drafts, candidates }`.
///
/// # Errors
///
/// Fails if the input does not match the shape, or the result cannot be serialized.
#[wasm_bindgen(js_name = triageReportedPaths, unchecked_return_type = "{ drafts: boolean; candidates: string[] }")]
pub fn triage_reported_paths_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ paths: readonly string[]; projectId: string | null }"
    )]
    input: JsValue,
) -> JsResult<JsValue> {
    let input: TriageInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&folder_report::triage_reported_paths(&input))
}
