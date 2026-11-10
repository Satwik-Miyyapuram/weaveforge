//! The vault note template engine (wf-core `vault::template`), for the TS wrappers.

use serde_json::json;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::vault::template::{self as tpl, RegionKind, TemplateContext};

use super::to_js;

/// Reads a JS context object into the Rust template context.
fn context(value: JsValue) -> Result<TemplateContext, wasm_bindgen::JsError> {
    serde_wasm_bindgen::from_value(value)
        .map_err(|err| wasm_bindgen::JsError::new(&err.to_string()))
}

/// [`substitute_variables`](tpl::substitute_variables).
///
/// # Errors
///
/// Fails if the context is not a plain object.
#[wasm_bindgen(js_name = substituteVariables)]
pub fn substitute_variables_js(
    template: &str,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] context_value: JsValue,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(tpl::substitute_variables(
        template,
        &context(context_value)?,
    ))
}

/// [`default_source_note_template`](tpl::default_source_note_template): the default source-note
/// template text, with generated metadata and editable summary, key points and notes.
#[wasm_bindgen(js_name = defaultSourceNoteTemplate)]
#[must_use]
pub fn default_source_note_template_js() -> String {
    tpl::default_source_note_template()
}

/// [`wrap_region`](tpl::wrap_region). Throws on an unknown kind.
///
/// # Errors
///
/// Fails if `kind` is neither `generated` nor `editable`.
#[wasm_bindgen(js_name = wrapRegion)]
pub fn wrap_region_js(kind: &str, name: &str, body: &str) -> Result<String, wasm_bindgen::JsError> {
    let kind =
        RegionKind::parse(kind).ok_or_else(|| wasm_bindgen::JsError::new("unknown region kind"))?;
    Ok(tpl::wrap_region(kind, name, body))
}

/// [`parse_regions`](tpl::parse_regions) as `{ ok, segments }` or `{ ok: false, reason }`.
///
/// # Errors
///
/// Fails only if the result cannot be serialised.
#[wasm_bindgen(js_name = parseRegions)]
pub fn parse_regions_js(document: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let out = match tpl::parse_regions(document) {
        Some(segments) => json!({ "ok": true, "segments": segments }),
        None => json!({ "ok": false, "reason": "malformed_markers" }),
    };
    to_js(&out)
}

/// [`strip_region_markers`](tpl::strip_region_markers).
#[wasm_bindgen(js_name = stripRegionMarkers)]
#[must_use]
pub fn strip_region_markers_js(document: &str) -> String {
    tpl::strip_region_markers(document)
}

/// [`render_template`](tpl::render_template).
///
/// # Errors
///
/// Fails if the context is not a plain object.
#[wasm_bindgen(js_name = renderTemplate)]
pub fn render_template_js(
    template: &str,
    #[wasm_bindgen(unchecked_param_type = "Record<string, unknown>")] context_value: JsValue,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(tpl::render_template(template, &context(context_value)?))
}

/// [`merge_template`](tpl::merge_template).
#[wasm_bindgen(js_name = mergeTemplate)]
#[must_use]
pub fn merge_template_js(existing: &str, rendered: &str) -> String {
    tpl::merge_template(existing, rendered)
}

/// [`apply_template`](tpl::apply_template). A null or undefined `existing` counts as empty.
///
/// # Errors
///
/// Fails if the context is not a plain object.
#[wasm_bindgen(js_name = applyTemplate)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn apply_template_js(
    existing: Option<String>,
    template: &str,
    context_value: JsValue,
) -> Result<String, wasm_bindgen::JsError> {
    Ok(tpl::apply_template(
        existing.as_deref(),
        template,
        &context(context_value)?,
    ))
}
