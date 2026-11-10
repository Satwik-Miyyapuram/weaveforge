//! Ink page helpers for JavaScript (wf-core `ink::ink_page`). The JS names match
//! `packages/core/src/ink/ink-note.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ink::ink_page::{self, InkStrokeInput};
use wf_core::sync::ink_note::InkPaper;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`ink_enum_index`](ink_page::ink_enum_index): the position of `value` in `values`, or `0`.
///
/// # Errors
///
/// Fails if `values` is not an array of strings.
#[wasm_bindgen(js_name = inkEnumIndex)]
pub fn ink_enum_index_js(values: JsValue, value: &str) -> JsResult<usize> {
    let values: Vec<String> = serde_wasm_bindgen::from_value(values)?;
    Ok(ink_page::ink_enum_index(&values, value))
}

/// [`ink_enum_value`](ink_page::ink_enum_value): the name at `index`, or the first entry
/// where out of range; `undefined` for an empty list.
///
/// # Errors
///
/// Fails if `values` is not an array of strings.
#[wasm_bindgen(js_name = inkEnumValue)]
pub fn ink_enum_value_js(values: JsValue, index: f64) -> JsResult<Option<String>> {
    let values: Vec<String> = serde_wasm_bindgen::from_value(values)?;
    Ok(ink_page::ink_enum_value(&values, index).map(str::to_owned))
}

/// [`make_ink_stroke`](ink_page::make_ink_stroke) with the defaults filled in.
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(js_name = makeInkStroke)]
pub fn make_ink_stroke_js(input: JsValue) -> JsResult<JsValue> {
    let input: InkStrokeInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&ink_page::make_ink_stroke(input))
}

/// [`blank_ink_page`](ink_page::blank_ink_page): an empty A4 page on `paper`, `blank` by default.
///
/// # Errors
///
/// Fails if `paper` is not a known paper name.
#[wasm_bindgen(js_name = blankInkPage)]
pub fn blank_ink_page_js(paper: JsValue) -> JsResult<JsValue> {
    let paper: Option<InkPaper> = serde_wasm_bindgen::from_value(paper)?;
    to_js(&ink_page::blank_ink_page(paper.unwrap_or(InkPaper::Blank)))
}

/// [`clamp_ink_page_size`](ink_page::clamp_ink_page_size): `{ width, height }` clamped to `Int16`.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = clampInkPageSize)]
pub fn clamp_ink_page_size_js(width: f64, height: f64) -> JsResult<JsValue> {
    to_js(&ink_page::clamp_ink_page_size(width, height))
}

/// [`ink_page_marker`](ink_page::ink_page_marker): the `<!-- page N -->` line for page `page`.
#[wasm_bindgen(js_name = inkPageMarker)]
pub fn ink_page_marker_js(page: f64) -> String {
    ink_page::ink_page_marker(page)
}

/// [`join_ink_text_layer`](ink_page::join_ink_text_layer): one text layer per page, joined.
///
/// # Errors
///
/// Fails if `pages` is not an array of strings.
#[wasm_bindgen(js_name = joinInkTextLayer)]
pub fn join_ink_text_layer_js(pages: JsValue) -> JsResult<String> {
    let pages: Vec<String> = serde_wasm_bindgen::from_value(pages)?;
    Ok(ink_page::join_ink_text_layer(&pages))
}

/// [`ink_page_background`](ink_page::ink_page_background): the background path, or `null`.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = inkPageBackground)]
pub fn ink_page_background_js(text: &str) -> JsResult<JsValue> {
    to_js(&ink_page::ink_page_background(text))
}

/// [`with_ink_page_background`](ink_page::with_ink_page_background): the text with its
/// background line set to `path`, or removed for `null`.
#[wasm_bindgen(js_name = withInkPageBackground)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn with_ink_page_background_js(text: &str, path: Option<String>) -> String {
    ink_page::with_ink_page_background(text, path.as_deref())
}

/// [`ink_attachment_index`](ink_page::ink_attachment_index): the attachment index of `path`, or `0`.
#[wasm_bindgen(js_name = inkAttachmentIndex)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn ink_attachment_index_js(body: &str, path: Option<String>) -> u8 {
    ink_page::ink_attachment_index(body, path.as_deref())
}

/// [`resolve_ink_page_order`](ink_page::resolve_ink_page_order): the reconciled page order.
///
/// # Errors
///
/// Fails if either list is not an array of strings.
#[wasm_bindgen(js_name = resolveInkPageOrder)]
pub fn resolve_ink_page_order_js(declared: JsValue, present: JsValue) -> JsResult<JsValue> {
    let declared: Vec<String> = serde_wasm_bindgen::from_value(declared)?;
    let present: Vec<String> = serde_wasm_bindgen::from_value(present)?;
    to_js(&ink_page::resolve_ink_page_order(&declared, &present))
}

/// [`ink_page_over_budget`](ink_page::ink_page_over_budget): whether the page has too many strokes.
///
/// # Errors
///
/// Fails if `page` has the wrong shape.
#[wasm_bindgen(js_name = inkPageOverBudget)]
pub fn ink_page_over_budget_js(
    #[wasm_bindgen(unchecked_param_type = "{ strokes: readonly unknown[] }")] page: JsValue,
) -> JsResult<bool> {
    let page: ink_page::InkPage = serde_wasm_bindgen::from_value(page)?;
    Ok(ink_page::ink_page_over_budget(&page))
}
