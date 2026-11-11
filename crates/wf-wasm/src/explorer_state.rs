//! Explorer open-row and open-section rules (wf-core `editor_workspace::explorer_state`).
//! Open sets cross the boundary as string arrays; the TS wrapper converts to and from `Set`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::editor_workspace::explorer_state as state;

use super::to_js;

/// [`default_expanded`](state::default_expanded).
///
/// # Errors
///
/// Fails if the argument is not an array of strings, or the result cannot be serialised.
#[wasm_bindgen(js_name = defaultExpanded, unchecked_return_type = "readonly string[]")]
pub fn default_expanded_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] roots: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let roots: Vec<String> = serde_wasm_bindgen::from_value(roots)?;
    to_js(&state::default_expanded(&roots))
}

/// [`migrated_expanded`](state::migrated_expanded).
///
/// # Errors
///
/// Fails if an argument is not an array of strings, or the result cannot be serialised.
#[wasm_bindgen(js_name = migratedExpanded)]
pub fn migrated_expanded_js(
    saved: JsValue,
    roots: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let saved: Vec<String> = serde_wasm_bindgen::from_value(saved)?;
    let roots: Vec<String> = serde_wasm_bindgen::from_value(roots)?;
    to_js(&state::migrated_expanded(&saved, &roots))
}

/// [`toggle_key`](state::toggle_key) for the expanded rows.
///
/// # Errors
///
/// Fails if the expanded argument is not an array of strings, or the result cannot be serialised.
#[wasm_bindgen(js_name = toggleExpanded)]
pub fn toggle_expanded_js(
    expanded: JsValue,
    key: &str,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let expanded: Vec<String> = serde_wasm_bindgen::from_value(expanded)?;
    to_js(&state::toggle_key(&expanded, key))
}

/// [`toggle_key`](state::toggle_key) for the open sections.
///
/// # Errors
///
/// Fails if the open argument is not an array of strings, or the result cannot be serialised.
#[wasm_bindgen(js_name = toggleSection)]
pub fn toggle_section_js(open: JsValue, id: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let open: Vec<String> = serde_wasm_bindgen::from_value(open)?;
    to_js(&state::toggle_key(&open, id))
}

/// [`is_open`](state::is_open).
///
/// # Errors
///
/// Fails if the open argument is not an array of strings.
#[wasm_bindgen(js_name = isSectionOpen)]
pub fn is_section_open_js(open: JsValue, id: &str) -> Result<bool, serde_wasm_bindgen::Error> {
    let open: Vec<String> = serde_wasm_bindgen::from_value(open)?;
    Ok(state::is_open(&open, id))
}

/// [`default_open_sections`](state::default_open_sections). Takes `{ id, collapsedByDefault }`
/// objects; extra fields are ignored.
///
/// # Errors
///
/// Fails if the argument is not an array of section declarations, or the result cannot be serialised.
#[wasm_bindgen(js_name = defaultOpenSections, unchecked_return_type = "string[]")]
pub fn default_open_sections_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly { id: string; collapsedByDefault?: boolean }[]"
    )]
    sections: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let sections: Vec<state::SectionDecl> = serde_wasm_bindgen::from_value(sections)?;
    to_js(&state::default_open_sections(&sections))
}

/// [`parse_explorer_keys`](state::parse_explorer_keys). Takes the raw stored
/// string (or `null` when absent) and returns the keys, or `null` when the
/// record is unusable.
///
/// # Errors
///
/// Fails only if the result cannot be serialised.
#[wasm_bindgen(js_name = parseExplorerKeys, unchecked_return_type = "string[] | null")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn parse_explorer_keys_js(raw: Option<String>) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&state::parse_explorer_keys(raw.as_deref()))
}
