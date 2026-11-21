//! Screening decisions kept in the reading-list file, for JavaScript (wf-core
//! `reading_lists::list_file`). Each export takes the file text and returns the new
//! text or the decisions; a damaged or newer-format file throws and nothing is written.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::reading_lists::list_file;
use wf_core::reading_lists::screening::ScreeningDecision;

use super::screening_records::list_from;
use super::to_js;

/// A thrown `Error` with the message; a bare string would reach JS without a name or stack.
fn js_error(error: impl std::fmt::Display) -> JsError {
    JsError::new(&error.to_string())
}

/// [`list_decisions`](list_file::list_decisions): every decision in the file, in file order.
///
/// # Errors
///
/// Throws when an entry cannot be read.
#[wasm_bindgen(js_name = screeningInListFile, unchecked_return_type = "B.ScreeningDecision[]")]
pub fn screening_in_list_file_js(text: &str) -> Result<JsValue, JsError> {
    let decisions = list_file::list_decisions(text).map_err(js_error)?;
    to_js(&decisions).map_err(js_error)
}

/// [`effective_decisions`](list_file::effective_decisions): per item, reviewer and stage,
/// the decision with the latest `decidedAt`.
///
/// # Errors
///
/// Fails if `decisions` has the wrong shape.
#[wasm_bindgen(js_name = effectiveScreening, unchecked_return_type = "B.ScreeningDecision[]")]
pub fn effective_screening_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ScreeningDecision[]")] decisions: JsValue,
) -> Result<JsValue, JsError> {
    let decisions: Vec<ScreeningDecision> = list_from(decisions).map_err(js_error)?;
    to_js(&list_file::effective_decisions(&decisions)).map_err(js_error)
}

/// [`record_decision`](list_file::record_decision): the file text with `decision` recorded.
///
/// # Errors
///
/// Throws on a damaged or newer-format file, or a bad decision shape.
#[wasm_bindgen(js_name = recordInListFile)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn record_in_list_file_js(
    text: &str,
    #[wasm_bindgen(unchecked_param_type = "B.ScreeningDecision")] decision: JsValue,
) -> Result<String, JsError> {
    let decision: ScreeningDecision = serde_wasm_bindgen::from_value(decision).map_err(js_error)?;
    list_file::record_decision(text, &decision).map_err(js_error)
}

/// [`remove_decision`](list_file::remove_decision): the file text without entry `id`.
///
/// # Errors
///
/// Throws on a damaged or newer-format file.
#[wasm_bindgen(js_name = removeFromListFile)]
pub fn remove_from_list_file_js(text: &str, id: &str) -> Result<String, JsError> {
    list_file::remove_decision(text, id).map_err(js_error)
}

/// [`mark_missing`](list_file::mark_missing): entries whose `[[link]]` points at no note
/// in `known_items` (also links) are marked missing, never dropped.
///
/// # Errors
///
/// Throws on a damaged or newer-format file.
#[wasm_bindgen(js_name = markMissingInListFile)]
pub fn mark_missing_in_list_file_js(
    text: &str,
    known_items: Vec<String>,
) -> Result<String, JsError> {
    list_file::mark_missing(text, &known_items).map_err(js_error)
}

/// [`holds_item`](list_file::holds_item): true when the list file has an entry for `item`,
/// whatever its state. Used to find the list file for an item.
///
/// # Errors
///
/// Throws on a damaged or newer-format file.
#[wasm_bindgen(js_name = listFileHoldsItem)]
pub fn list_file_holds_item_js(text: &str, item: &str) -> Result<bool, JsError> {
    list_file::holds_item(text, item).map_err(js_error)
}

/// [`item_key`](list_file::item_key): the note a `[[link]]` points at, so links to the
/// same note compare equal; `undefined` when `item` is not one link.
#[must_use]
#[wasm_bindgen(js_name = listItemKey)]
pub fn list_item_key_js(item: &str) -> Option<String> {
    list_file::item_key(item)
}
