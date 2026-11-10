//! Per-kind table and lookups (wf-core `editor_workspace::kind`).
//! Kind names and bodies come in as strings; values go out via `to_js`, so
//! `None` arrives as `null`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::editor_workspace::kind as rules;

use super::to_js;

/// [`rules::KINDS`] as a string array.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = kindNames)]
pub fn kind_names_js() -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&rules::KINDS)
}

/// [`rules::kind_icon`].
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = kindIcon)]
pub fn kind_icon_js(kind: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&rules::kind_icon(kind))
}

/// [`rules::is_document_kind`].
#[wasm_bindgen(js_name = isDocumentKind)]
pub fn is_document_kind_js(kind: &str) -> bool {
    rules::is_document_kind(kind)
}

/// [`rules::has_pdf_view`].
#[wasm_bindgen(js_name = hasPdfView)]
pub fn has_pdf_view_js(kind: &str) -> bool {
    rules::has_pdf_view(kind)
}

/// [`rules::has_ink_view`].
#[wasm_bindgen(js_name = hasInkView)]
pub fn has_ink_view_js(kind: &str) -> bool {
    rules::has_ink_view(kind)
}

/// [`rules::has_lazy_body`].
#[wasm_bindgen(js_name = hasLazyBody)]
pub fn has_lazy_body_js(kind: &str) -> bool {
    rules::has_lazy_body(kind)
}

/// [`rules::is_creatable_kind`].
#[wasm_bindgen(js_name = isCreatableKind)]
pub fn is_creatable_kind_js(kind: &str) -> bool {
    rules::is_creatable_kind(kind)
}

/// [`rules::kind_owner`].
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = kindOwner)]
pub fn kind_owner_js(kind: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&rules::kind_owner(kind))
}

/// [`rules::member_rank`].
#[wasm_bindgen(js_name = memberRank)]
pub fn member_rank_js(kind: &str) -> i32 {
    rules::member_rank(kind)
}

/// [`rules::link_group_of`].
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = linkGroupOf)]
pub fn link_group_of_js(kind: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&rules::link_group_of(kind))
}

/// [`rules::kind_tint_class`].
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = kindTintClass)]
pub fn kind_tint_class_js(kind: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&rules::kind_tint_class(kind))
}

/// [`rules::kind_icon_class`]. `open` defaults to false.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = kindIconClass)]
pub fn kind_icon_class_js(
    kind: &str,
    open: Option<bool>,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&rules::kind_icon_class(kind, open.unwrap_or(false)))
}

/// [`rules::kind_suffix`].
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = kindSuffix)]
pub fn kind_suffix_js(kind: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&rules::kind_suffix(kind))
}

/// [`rules::document_suffix`].
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = documentSuffix)]
pub fn document_suffix_js(kind: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&rules::document_suffix(kind))
}

/// [`rules::modes_for`].
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = modesFor)]
pub fn modes_for_js(kind: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&rules::modes_for(kind))
}

/// [`rules::default_mode_for`].
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = defaultModeFor)]
pub fn default_mode_for_js(kind: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&rules::default_mode_for(kind))
}

/// [`rules::open_mode_for`].
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = openModeFor)]
pub fn open_mode_for_js(kind: &str, body: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&rules::open_mode_for(kind, body))
}

/// [`rules::opening_tab`]. `body` absent reads as an empty body.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = openingTab)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn opening_tab_js(
    kind: &str,
    id: &str,
    body: Option<String>,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&rules::opening_tab(kind, id, body.as_deref()))
}

/// [`rules::document_kind`].
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = documentKind)]
pub fn document_kind_js(kind: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&rules::document_kind(kind))
}

/// [`rules::segments_for`].
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = segmentsFor)]
pub fn segments_for_js(kind: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&rules::segments_for(kind))
}
