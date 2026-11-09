//! Merging a duplicate paper into the copy kept (wf-core `papers::paper_merge`). The TS
//! wrapper in `packages/wf-wasm/src/papers-merge.ts` re-exports the generated types.

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::papers::paper_merge::{MergePaper, merge_paper_into};

use super::to_js;

/// [`merge_paper_into`] (TS `mergePaperInto`). The kept paper with the duplicate's gaps filled.
///
/// # Errors
///
/// Fails if either argument is not a paper, or the result cannot be converted.
#[wasm_bindgen(js_name = mergePaperInto)]
pub fn merge_paper_into_js(keep: JsValue, dup: JsValue) -> Result<JsValue, JsError> {
    let keep: MergePaper =
        serde_wasm_bindgen::from_value(keep).map_err(|error| JsError::new(&error.to_string()))?;
    let dup: MergePaper =
        serde_wasm_bindgen::from_value(dup).map_err(|error| JsError::new(&error.to_string()))?;
    to_js(&merge_paper_into(&keep, &dup)).map_err(|error| JsError::new(&error.to_string()))
}
