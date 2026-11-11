//! Outline-from-text helpers (Rust `reader_analysis::outline`). Each export wraps
//! one function; the JS names and shapes match
//! `packages/core/src/features/reader/outline-from-text.ts`.
//!
//! Objects cross as plain JS objects through serde; numbers cross as f64.
//! `isRotatedText` takes a `Float64Array`. The TS wrappers in
//! `packages/wf-wasm/src/wrappers-6.ts` apply the defaults.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader_analysis::outline as analysis_outline;
use wf_core::reader_analysis::outline::{
    OutlinePageRef, OutlineRecurringGroupIndices, OutlineTextItem,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`is_rotated_text`](analysis_outline::is_rotated_text) (TS `isRotatedText`).
#[wasm_bindgen(js_name = isRotatedText)]
#[must_use]
pub fn is_rotated_text_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] transform: &[f64],
) -> bool {
    analysis_outline::is_rotated_text(transform)
}

/// [`outline_text_lines`](analysis_outline::outline_text_lines) (TS `outlineTextLines`).
///
/// # Errors
///
/// Fails if `pages` is not an array of arrays of text items.
#[wasm_bindgen(js_name = outlineTextLines, unchecked_return_type = "B.OutlineTextItem[]")]
pub fn outline_text_lines_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly B.OutlineTextItem[])[]")]
    pages: JsValue,
) -> JsResult<JsValue> {
    let pages: Vec<Vec<OutlineTextItem>> = serde_wasm_bindgen::from_value(pages)?;
    to_js(&analysis_outline::outline_text_lines(&pages))
}

/// [`body_font_size`](analysis_outline::body_font_size) (TS `bodyFontSize`).
///
/// # Errors
///
/// Fails if `pages` is not an array of arrays of text items.
#[wasm_bindgen(js_name = bodyFontSize)]
pub fn body_font_size_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly B.OutlineTextItem[])[]")]
    pages: JsValue,
) -> JsResult<f64> {
    let pages: Vec<Vec<OutlineTextItem>> = serde_wasm_bindgen::from_value(pages)?;
    Ok(analysis_outline::body_font_size(&pages))
}

/// [`levenshtein`](analysis_outline::levenshtein) (TS `levenshtein`).
#[wasm_bindgen(js_name = levenshtein)]
#[must_use]
pub fn levenshtein_js(a: &str, b: &str, limit: Option<f64>) -> f64 {
    analysis_outline::levenshtein(a, b, limit.unwrap_or(f64::INFINITY))
}

/// [`group_recurring_lines`](analysis_outline::group_recurring_lines) (TS `groupRecurringLines`).
/// The TS wrapper passes each line's text and page; members come back as indices.
///
/// # Errors
///
/// Fails if `texts` is not an array of strings or `pages` is not an array of numbers.
// Indices stay far below 2^53, so the `usize` to `f64` cast is exact.
#[allow(clippy::cast_precision_loss)]
#[wasm_bindgen(js_name = groupRecurringLines)]
pub fn group_recurring_lines_js(texts: JsValue, pages: JsValue) -> JsResult<JsValue> {
    let texts: Vec<String> = serde_wasm_bindgen::from_value(texts)?;
    let pages: Vec<f64> = serde_wasm_bindgen::from_value(pages)?;
    let indices: Vec<usize> = (0..texts.len()).collect();
    let groups: Vec<OutlineRecurringGroupIndices> = analysis_outline::group_recurring_lines(
        indices.as_slice(),
        |&i| texts.get(i).cloned().unwrap_or_default(),
        |&i| pages.get(i).copied().unwrap_or(f64::NAN),
    )
    .into_iter()
    .map(|group| OutlineRecurringGroupIndices {
        key: group.key,
        pages: group.pages,
        members: group.members.into_iter().map(|&i| i as f64).collect(),
    })
    .collect();
    to_js(&groups)
}

/// [`outline_from_text`](analysis_outline::outline_from_text) (TS `outlineFromText`).
///
/// # Errors
///
/// Fails if `allPages` is not an array of arrays of text items.
#[wasm_bindgen(js_name = outlineFromText, unchecked_return_type = "B.OutlineReaderItem[]")]
pub fn outline_from_text_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly B.OutlineTextItem[])[]")]
    all_pages: JsValue,
) -> JsResult<JsValue> {
    let all_pages: Vec<Vec<OutlineTextItem>> = serde_wasm_bindgen::from_value(all_pages)?;
    to_js(&analysis_outline::outline_from_text(&all_pages))
}

/// [`outline_is_plausible`](analysis_outline::outline_is_plausible) (TS `outlineIsPlausible`).
///
/// # Errors
///
/// Fails if `headings` is not an array of `{ page }` objects.
#[wasm_bindgen(js_name = outlineIsPlausible)]
pub fn outline_is_plausible_js(
    #[wasm_bindgen(unchecked_param_type = "readonly { page: number }[]")] headings: JsValue,
    page_count: f64,
) -> JsResult<bool> {
    let headings: Vec<OutlinePageRef> = serde_wasm_bindgen::from_value(headings)?;
    Ok(analysis_outline::outline_is_plausible(
        &headings, page_count,
    ))
}
