//! `.bib` import for JavaScript (wf-core `papers::bib_import`).

use serde_json::Value;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::bib_import::{self, BibImportPaper};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`bib_paper_input`](bib_import::bib_paper_input) (TS `bibPaperInput`).
///
/// # Errors
///
/// Fails if `entry` cannot be read as a planned `.bib` entry.
#[wasm_bindgen(
    js_name = bibPaperInput,
    unchecked_return_type = "{ title: string; authors: string[]; year?: number; venue?: string; doi?: string; arxivId?: string; url?: string; abstract?: string; bibtex: string; metadata: { citeKey: string } }"
)]
pub fn bib_paper_input_js(
    #[wasm_bindgen(unchecked_param_type = "B.BibImportPaper")] entry: JsValue,
) -> JsResult<JsValue> {
    let entry: BibImportPaper = serde_wasm_bindgen::from_value(entry)?;
    to_js(&bib_import::bib_paper_input(&entry))
}

/// [`cite_key_of`](bib_import::cite_key_of) (TS `citeKeyOf`): the citation key of a paper's
/// metadata bag, or `undefined` when it is not a string that is not blank.
///
/// # Errors
///
/// Fails if `metadata` cannot be read as a JSON value.
#[wasm_bindgen(js_name = citeKeyOf)]
pub fn cite_key_of_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] metadata: JsValue,
) -> JsResult<Option<String>> {
    let metadata: Option<Value> = serde_wasm_bindgen::from_value(metadata)?;
    Ok(bib_import::cite_key_of(metadata.as_ref()))
}

/// [`plan_bib_import`](bib_import::plan_bib_import) (TS `planBibImport`).
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[wasm_bindgen(js_name = planBibImport, unchecked_return_type = "B.BibImportPlan")]
pub fn plan_bib_import_js(
    file_name: &str,
    text: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] existing_dois: Vec<String>,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] existing_keys: Vec<String>,
) -> JsResult<JsValue> {
    to_js(&bib_import::plan_bib_import(
        file_name,
        text,
        &existing_dois,
        &existing_keys,
    ))
}
