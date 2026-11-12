//! Cite-key helpers for JavaScript (wf-core `report::cite_key`). Each export wraps one function;
//! the JS names match `packages/core/src/features/report/domain/parts.ts`.
//!
//! The paper is the subset of `Paper` these functions read (a `Paper` satisfies it). Only
//! string values of `doi`, `arxivId`, `bibtex` and `metadata.{citeKey, citationKey, extra}`
//! count; anything else reads as missing.

use js_sys::{Reflect, Set};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::report::cite_key;
use wf_core::report::cite_key::CiteKeyPaper;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// `target[key]`, or `undefined` when `target` is not an object or the read throws.
fn get(target: &JsValue, key: &str) -> JsValue {
    if target.is_object() {
        Reflect::get(target, &JsValue::from_str(key)).unwrap_or(JsValue::UNDEFINED)
    } else {
        JsValue::UNDEFINED
    }
}

/// The cite-key fields of a JS paper: `id` must be a string; the others count only as strings.
fn to_cite_key_paper(paper: &JsValue) -> JsResult<CiteKeyPaper> {
    let meta = get(paper, "metadata");
    Ok(CiteKeyPaper {
        id: serde_wasm_bindgen::from_value(get(paper, "id"))?,
        doi: get(paper, "doi").as_string(),
        arxiv_id: get(paper, "arxivId").as_string(),
        bibtex: get(paper, "bibtex").as_string(),
        cite_key: get(&meta, "citeKey").as_string(),
        citation_key: get(&meta, "citationKey").as_string(),
        extra: get(&meta, "extra").as_string(),
    })
}

/// [`resolve_cite_key`](cite_key::resolve_cite_key) (TS `resolveCiteKey`): a paper's preferred
/// cite key, without uniqueness suffixing. Never empty.
///
/// # Errors
///
/// Fails if `paper.id` is not a string.
#[wasm_bindgen(js_name = resolveCiteKey)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn resolve_cite_key_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ id: string; doi?: string; arxivId?: string; bibtex?: string; metadata?: Record<string, unknown> }"
    )]
    paper: JsValue,
) -> JsResult<String> {
    Ok(cite_key::resolve_cite_key(&to_cite_key_paper(&paper)?))
}

/// [`unique_cite_key`](cite_key::unique_cite_key) (TS `uniqueCiteKey`): the resolved key, made
/// unique against `used`. `used` is mutated: the returned key is added to it.
///
/// # Errors
///
/// Fails if `paper.id` is not a string, or `used` holds a non-string.
#[wasm_bindgen(js_name = uniqueCiteKey)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn unique_cite_key_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ id: string; doi?: string; arxivId?: string; bibtex?: string; metadata?: Record<string, unknown> }"
    )]
    paper: JsValue,
    #[wasm_bindgen(unchecked_param_type = "Set<string>")] used: Set,
) -> JsResult<String> {
    let paper = to_cite_key_paper(&paper)?;
    let taken: Vec<String> = serde_wasm_bindgen::from_value(JsValue::from(used.clone()))?;
    let key = cite_key::unique_cite_key(&paper, &taken);
    let _ = used.add(&JsValue::from_str(&key));
    Ok(key)
}

/// [`format_citation`](cite_key::format_citation) (TS `formatCitation`).
#[wasm_bindgen(js_name = formatCitation)]
#[must_use]
pub fn format_citation_js(key: &str, format: &str) -> String {
    cite_key::format_citation(key, format)
}

/// [`format_paper_citation`](cite_key::format_paper_citation) (TS `formatPaperCitation`):
/// resolve then format in one step.
///
/// # Errors
///
/// Fails if `paper.id` is not a string.
#[wasm_bindgen(js_name = formatPaperCitation)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn format_paper_citation_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ id: string; doi?: string; arxivId?: string; bibtex?: string; metadata?: Record<string, unknown> }"
    )]
    paper: JsValue,
    #[wasm_bindgen(unchecked_param_type = "\"latex\" | \"pandoc\" | \"footnote\" | \"raw\"")]
    format: &str,
) -> JsResult<String> {
    Ok(cite_key::format_paper_citation(
        &to_cite_key_paper(&paper)?,
        format,
    ))
}
