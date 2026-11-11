//! Graph view settings for JavaScript (wf-core `relations::graph_settings`). The JS names
//! match `packages/core/src/features/relations/domain/parts.ts` and
//! `graph-persisted-state.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::graph_settings::{self, GraphViewSettings};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// Any JS value as JSON. `undefined`, functions and symbols read as `null`.
fn json_from(raw: JsValue) -> JsResult<serde_json::Value> {
    if raw.is_undefined() {
        return Ok(serde_json::Value::Null);
    }
    serde_wasm_bindgen::from_value(raw)
}

/// [`default_graph_settings`](graph_settings::default_graph_settings).
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = defaultGraphSettings, unchecked_return_type = "B.GraphViewSettings")]
pub fn default_graph_settings_js() -> JsResult<JsValue> {
    to_js(&graph_settings::default_graph_settings())
}

/// [`normalize_graph_view_settings`](graph_settings::normalize_graph_view_settings).
///
/// # Errors
///
/// Fails if `raw` cannot be read as JSON.
#[wasm_bindgen(js_name = normalizeGraphViewSettings, unchecked_return_type = "B.GraphViewSettings")]
pub fn normalize_graph_view_settings_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] raw: JsValue,
) -> JsResult<JsValue> {
    to_js(&graph_settings::normalize_graph_view_settings(&json_from(
        raw,
    )?))
}

/// [`effective_relation_types`](graph_settings::effective_relation_types).
///
/// # Errors
///
/// Fails if `settings` has the wrong shape.
#[wasm_bindgen(js_name = effectiveRelationTypes, unchecked_return_type = "B.RelationType[]")]
pub fn effective_relation_types_js(
    #[wasm_bindgen(unchecked_param_type = "B.GraphViewSettings")] settings: JsValue,
) -> JsResult<JsValue> {
    let settings: GraphViewSettings = serde_wasm_bindgen::from_value(settings)?;
    to_js(&graph_settings::effective_relation_types(&settings))
}

/// [`graph_filter_count`](graph_settings::graph_filter_count), given the two selection sizes.
///
/// # Errors
///
/// Fails if `settings` has the wrong shape.
#[wasm_bindgen(js_name = graphFilterCountFor)]
pub fn graph_filter_count_js(
    selected_tags: usize,
    selected_lists: usize,
    #[wasm_bindgen(unchecked_param_type = "B.GraphViewSettings")] settings: JsValue,
) -> JsResult<u32> {
    let settings: GraphViewSettings = serde_wasm_bindgen::from_value(settings)?;
    Ok(graph_settings::graph_filter_count(
        selected_tags,
        selected_lists,
        &settings,
    ))
}

/// [`parse_graph_persisted_state`](graph_settings::parse_graph_persisted_state); `null` when absent.
///
/// # Errors
///
/// Fails if `raw` cannot be read as JSON.
#[wasm_bindgen(js_name = parseGraphPersistedState, unchecked_return_type = "B.GraphPersistedState | null")]
pub fn parse_graph_persisted_state_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] raw: JsValue,
) -> JsResult<JsValue> {
    to_js(&graph_settings::parse_graph_persisted_state(&json_from(
        raw,
    )?))
}

/// [`show_relation_edges`](graph_settings::show_relation_edges).
///
/// # Errors
///
/// Fails if `settings` has the wrong shape.
#[wasm_bindgen(js_name = showRelationEdges)]
pub fn show_relation_edges_js(
    #[wasm_bindgen(unchecked_param_type = "B.GraphViewSettings")] settings: JsValue,
) -> JsResult<bool> {
    let settings: GraphViewSettings = serde_wasm_bindgen::from_value(settings)?;
    Ok(graph_settings::show_relation_edges(&settings))
}

/// [`show_concept_edges`](graph_settings::show_concept_edges).
///
/// # Errors
///
/// Fails if `settings` has the wrong shape.
#[wasm_bindgen(js_name = showConceptEdges)]
pub fn show_concept_edges_js(
    #[wasm_bindgen(unchecked_param_type = "B.GraphViewSettings")] settings: JsValue,
) -> JsResult<bool> {
    let settings: GraphViewSettings = serde_wasm_bindgen::from_value(settings)?;
    Ok(graph_settings::show_concept_edges(&settings))
}
