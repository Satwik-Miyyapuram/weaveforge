//! `.bib` import for JavaScript (wf-core `papers::bib_import`).
//!
//! The TS wrapper in `packages/wf-wasm/src/papers-bib-import.ts` gives the result its type.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::bib_import;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`plan_bib_import`](bib_import::plan_bib_import) (TS `planBibImport`).
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[wasm_bindgen(js_name = planBibImport)]
pub fn plan_bib_import_js(
    file_name: &str,
    text: &str,
    existing_dois: Vec<String>,
    existing_keys: Vec<String>,
) -> JsResult<JsValue> {
    to_js(&bib_import::plan_bib_import(
        file_name,
        text,
        &existing_dois,
        &existing_keys,
    ))
}
