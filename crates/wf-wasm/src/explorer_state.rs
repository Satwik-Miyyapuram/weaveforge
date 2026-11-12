//! Explorer open-row and open-section rules (wf-core `editor_workspace::explorer_state`).
//! Open rows and sections cross the boundary as JS `Set`s of keys.

use js_sys::{Array, Object, Reflect, Set};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::editor_workspace::explorer_state as state;

use super::to_js;

/// The strings in a `Set` (or any iterable) of keys.
fn keys_in(keys: &JsValue) -> Result<Vec<String>, serde_wasm_bindgen::Error> {
    serde_wasm_bindgen::from_value(Array::from(keys).into())
}

/// `keys` as a new JS `Set`, in order.
fn set_of(keys: &[String]) -> Set {
    let items: Array = keys.iter().map(|key| JsValue::from_str(key)).collect();
    Set::new(&items)
}

/// The keys of `sections.open`.
fn open_keys(sections: &JsValue) -> Result<Vec<String>, serde_wasm_bindgen::Error> {
    let open = Reflect::get(sections, &JsValue::from_str("open"))
        .map_err(|_| serde_wasm_bindgen::Error::new("the section state has no open set"))?;
    keys_in(&open)
}

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

/// [`migrated_expanded`](state::migrated_expanded): the saved keys plus any root the record never
/// mentioned. Saved keys win.
///
/// # Errors
///
/// Fails if an argument does not hold only strings.
#[wasm_bindgen(js_name = migratedExpanded, unchecked_return_type = "Set<string>")]
pub fn migrated_expanded_js(
    #[wasm_bindgen(unchecked_param_type = "ReadonlySet<string>")] saved: &JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] roots: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let saved = keys_in(saved)?;
    let roots: Vec<String> = serde_wasm_bindgen::from_value(roots)?;
    Ok(set_of(&state::migrated_expanded(&saved, &roots)).into())
}

/// [`toggle_key`](state::toggle_key) for the expanded rows: a new set with `key` flipped; never
/// mutates.
///
/// # Errors
///
/// Fails if `expanded` does not hold only strings.
#[wasm_bindgen(js_name = toggleExpanded, unchecked_return_type = "Set<string>")]
pub fn toggle_expanded_js(
    #[wasm_bindgen(unchecked_param_type = "ReadonlySet<string>")] expanded: &JsValue,
    key: &str,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let expanded = keys_in(expanded)?;
    Ok(set_of(&state::toggle_key(&expanded, key)).into())
}

/// [`toggle_key`](state::toggle_key) for the open sections: opens or closes one section, touching
/// no other. Returns a new `{ open }` state.
///
/// # Errors
///
/// Fails if `sections.open` does not hold only strings.
#[wasm_bindgen(js_name = toggleSection, unchecked_return_type = "{ open: ReadonlySet<string> }")]
pub fn toggle_section_js(
    #[wasm_bindgen(unchecked_param_type = "{ open: ReadonlySet<string> }")] sections: &JsValue,
    id: &str,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let open = set_of(&state::toggle_key(&open_keys(sections)?, id));
    let out = Object::new();
    let _ = Reflect::set(&out, &JsValue::from_str("open"), &open)
        .map_err(|_| serde_wasm_bindgen::Error::new("cannot build the section state"))?;
    Ok(out.unchecked_into())
}

/// [`is_open`](state::is_open): whether section `id` is open in `sections`.
///
/// # Errors
///
/// Fails if `sections.open` does not hold only strings.
#[wasm_bindgen(js_name = isSectionOpen)]
pub fn is_section_open_js(
    #[wasm_bindgen(unchecked_param_type = "{ open: ReadonlySet<string> }")] sections: &JsValue,
    id: &str,
) -> Result<bool, serde_wasm_bindgen::Error> {
    Ok(state::is_open(&open_keys(sections)?, id))
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
