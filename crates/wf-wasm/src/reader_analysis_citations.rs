//! Citation candidates and pattern mentions for JavaScript (wf-core `reader_analysis::citations`).
//! Each export wraps one function; the JS names and shapes match
//! `packages/core/src/features/reader/analysis/citations.ts`.
//!
//! Objects cross as plain JS objects through serde; the exports apply the defaults.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader_analysis::citations as analysis_citations;
use wf_core::reader_analysis::types::AnalysisParsedReference;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`match_author_year_text`](analysis_citations::match_author_year_text) (TS `matchAuthorYearText`).
///
/// # Errors
///
/// Fails if `refs` is not an array of parsed references.
#[wasm_bindgen(js_name = matchAuthorYearText, unchecked_return_type = "number[]")]
pub fn match_author_year_text_js(
    text: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly B.AnalysisParsedReference[]")] refs: JsValue,
) -> JsResult<JsValue> {
    let refs: Vec<AnalysisParsedReference> = serde_wasm_bindgen::from_value(refs)?;
    to_js(&analysis_citations::match_author_year_text(text, &refs))
}
