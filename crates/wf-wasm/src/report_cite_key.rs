//! Cite-key helpers for JavaScript (wf-core `report::cite_key`). Each export wraps one function;
//! the JS names match `packages/core/src/features/report/domain/parts.ts`.
//!
//! The paper crosses as a plain JS object through serde. The TS wrappers in
//! `packages/wf-wasm/src/wrappers-8.ts` pick the string fields and apply the `Set` handling.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::report::cite_key;
use wf_core::report::cite_key::CiteKeyPaper;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`resolve_cite_key`](cite_key::resolve_cite_key) (TS `resolveCiteKey`).
///
/// # Errors
///
/// Fails if `paper` is not an object with a string `id`.
#[wasm_bindgen(js_name = resolveCiteKey)]
pub fn resolve_cite_key_js(paper: JsValue) -> JsResult<String> {
    let paper: CiteKeyPaper = serde_wasm_bindgen::from_value(paper)?;
    Ok(cite_key::resolve_cite_key(&paper))
}

/// [`unique_cite_key`](cite_key::unique_cite_key) (TS `uniqueCiteKey`). `used` is a JS array of
/// strings; the caller records the returned key.
///
/// # Errors
///
/// Fails if `paper` is not an object with a string `id`, or `used` is not an array of strings.
#[wasm_bindgen(js_name = uniqueCiteKey)]
pub fn unique_cite_key_js(paper: JsValue, used: JsValue) -> JsResult<String> {
    let paper: CiteKeyPaper = serde_wasm_bindgen::from_value(paper)?;
    let used: Vec<String> = serde_wasm_bindgen::from_value(used)?;
    Ok(cite_key::unique_cite_key(&paper, &used))
}

/// [`format_citation`](cite_key::format_citation) (TS `formatCitation`).
#[wasm_bindgen(js_name = formatCitation)]
#[must_use]
pub fn format_citation_js(key: &str, format: &str) -> String {
    cite_key::format_citation(key, format)
}

/// [`format_paper_citation`](cite_key::format_paper_citation) (TS `formatPaperCitation`).
///
/// # Errors
///
/// Fails if `paper` is not an object with a string `id`.
#[wasm_bindgen(js_name = formatPaperCitation)]
pub fn format_paper_citation_js(paper: JsValue, format: &str) -> JsResult<String> {
    let paper: CiteKeyPaper = serde_wasm_bindgen::from_value(paper)?;
    Ok(cite_key::format_paper_citation(&paper, format))
}
