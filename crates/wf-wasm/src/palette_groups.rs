//! Jump palette headings, page matches and mode keys for JavaScript (wf-core `palette_groups`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::palette_groups::{self, PaletteGroup, PaletteKey};

use super::to_js;

/// [`group_palette_rows`](palette_groups::group_palette_rows): the headings present, each with the
/// indices of its rows, from the group of each row.
///
/// # Errors
///
/// Fails if `groups` has the wrong shape.
#[wasm_bindgen(js_name = groupPaletteRows, unchecked_return_type = "B.GroupedRows[]")]
pub fn group_palette_rows_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.PaletteGroup[]")] groups: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let groups: Vec<PaletteGroup> = serde_wasm_bindgen::from_value(groups)?;
    to_js(&palette_groups::group_palette_rows(&groups))
}

/// [`matching_page_indices`](palette_groups::matching_page_indices): the indices of the labels that
/// hold `query`, names that start with it first.
///
/// # Errors
///
/// Fails if `query` is too long or `labels` is not an array of strings.
#[wasm_bindgen(js_name = matchingPageIndices, unchecked_return_type = "number[]")]
pub fn matching_page_indices_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] labels: JsValue,
    query: js_sys::JsString,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let query = &crate::guarded_text(&query)?;
    let labels: Vec<String> = serde_wasm_bindgen::from_value(labels)?;
    to_js(&palette_groups::matching_page_indices(&labels, query))
}

/// [`command_match_indices`](palette_groups::command_match_indices): every index for an empty
/// query, else the page rule.
///
/// # Errors
///
/// Fails if `query` is too long or `labels` is not an array of strings.
#[wasm_bindgen(js_name = commandMatchIndices, unchecked_return_type = "number[]")]
pub fn command_match_indices_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] labels: JsValue,
    query: js_sys::JsString,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let query = &crate::guarded_text(&query)?;
    let labels: Vec<String> = serde_wasm_bindgen::from_value(labels)?;
    to_js(&palette_groups::command_match_indices(&labels, query))
}

/// [`palette_mode_for`](palette_groups::palette_mode_for): the mode a key press opens, or `null`.
///
/// # Errors
///
/// Fails if `event` has the wrong shape.
#[wasm_bindgen(js_name = paletteModeFor, unchecked_return_type = "B.PaletteMode | null")]
pub fn palette_mode_for_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaletteKey")] event: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let event: PaletteKey = serde_wasm_bindgen::from_value(event)?;
    to_js(&palette_groups::palette_mode_for(&event))
}
