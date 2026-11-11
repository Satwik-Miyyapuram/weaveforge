//! Which PDF pages an answer names (wf-core `ink::pdf_pages`), re-exported from
//! `packages/wf-wasm/src/wrappers-5.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::pdf_pages;

use super::to_js;

/// [`is_all_pages`](pdf_pages::is_all_pages).
#[wasm_bindgen(js_name = isAllPages)]
#[must_use]
pub fn is_all_pages_js(answer: &str) -> bool {
    pdf_pages::is_all_pages(answer)
}

/// [`parse_page_list`](pdf_pages::parse_page_list) as `{ pages, outOfRange? }`.
///
/// # Errors
///
/// Fails only if the result cannot be serialised.
#[wasm_bindgen(js_name = parsePageList, unchecked_return_type = "B.PageSelection")]
pub fn parse_page_list_js(
    answer: &str,
    count: f64,
) -> Result<wasm_bindgen::JsValue, serde_wasm_bindgen::Error> {
    to_js(&pdf_pages::parse_page_list(answer, count))
}

/// [`selected_pdf_pages`](pdf_pages::selected_pdf_pages) as an array of page numbers.
///
/// # Errors
///
/// Fails only if the result cannot be serialised.
#[wasm_bindgen(js_name = selectedPdfPages, unchecked_return_type = "number[]")]
pub fn selected_pdf_pages_js(
    answer: &str,
    count: f64,
) -> Result<wasm_bindgen::JsValue, serde_wasm_bindgen::Error> {
    to_js(&pdf_pages::selected_pdf_pages(answer, count))
}

/// [`page_list_problem`](pdf_pages::page_list_problem): the message, or `null`.
///
/// # Errors
///
/// Fails only if the result cannot be serialised.
#[wasm_bindgen(js_name = pageListProblem, unchecked_return_type = "string | null")]
pub fn page_list_problem_js(
    answer: &str,
    count: f64,
) -> Result<wasm_bindgen::JsValue, serde_wasm_bindgen::Error> {
    to_js(&pdf_pages::page_list_problem(answer, count))
}
