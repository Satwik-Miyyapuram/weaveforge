//! Dashboard card registry for JavaScript (wf-core `dashboard::card_registry`). The catalog,
//! role gates, data-source deps and fitted-list heights are Rust; the card renderers stay in
//! `apps/web/src/features/dashboard/ui/cards`. An unknown card type throws, as the old TS
//! `getCardDef` did.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::dashboard::card_registry;

use super::to_js;

/// A thrown `Error` with the message; a bare string would reach JS without a name or stack.
fn js_error(error: impl std::fmt::Display) -> JsError {
    JsError::new(&error.to_string())
}

fn js(value: &impl serde::Serialize) -> Result<JsValue, JsError> {
    to_js(value).map_err(js_error)
}

/// A JS array of card type ids, as the TS callers pass them.
fn read_types(value: JsValue) -> Result<Vec<String>, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(js_error)
}

/// [`registry`](card_registry::registry): every card's catalog entry, in picker order.
///
/// # Errors
///
/// Fails if the catalog cannot be converted to a JS value.
#[wasm_bindgen(js_name = dashboardCardRegistry, unchecked_return_type = "unknown")]
pub fn dashboard_card_registry_js() -> Result<JsValue, JsError> {
    js(&card_registry::registry())
}

/// [`card_def`](card_registry::card_def): one card's catalog entry.
///
/// # Errors
///
/// Fails on an unknown card type.
#[wasm_bindgen(js_name = dashboardCardDef, unchecked_return_type = "unknown")]
pub fn dashboard_card_def_js(card_type: &str) -> Result<JsValue, JsError> {
    js(card_registry::card_def(card_type).map_err(js_error)?)
}

/// [`cards_for_role`](card_registry::cards_for_role): the cards a viewer with `role` may add.
///
/// # Errors
///
/// Fails if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = dashboardCardsForRole, unchecked_return_type = "unknown")]
pub fn dashboard_cards_for_role_js(role: Option<String>) -> Result<JsValue, JsError> {
    js(&card_registry::cards_for_role(role.as_deref()))
}

/// [`is_stat_card`](card_registry::is_stat_card).
///
/// # Errors
///
/// Fails on an unknown card type.
#[wasm_bindgen(js_name = dashboardIsStatCard)]
pub fn dashboard_is_stat_card_js(card_type: &str) -> Result<bool, JsError> {
    card_registry::is_stat_card(card_type).map_err(js_error)
}

/// [`data_sources_for_card_types`](card_registry::data_sources_for_card_types): the union of
/// the cards' data sources, each once.
///
/// # Errors
///
/// Fails on an unknown card type or a bad input shape.
#[wasm_bindgen(js_name = dashboardDataSourcesForCardTypes, unchecked_return_type = "string[]")]
pub fn dashboard_data_sources_for_card_types_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] card_types: JsValue,
) -> Result<JsValue, JsError> {
    let types = read_types(card_types)?;
    let refs: Vec<&str> = types.iter().map(String::as_str).collect();
    js(&card_registry::data_sources_for_card_types(&refs).map_err(js_error)?)
}

/// [`resolve_deps`](card_registry::resolve_deps): the sources to fetch, every source when no
/// card is visible.
///
/// # Errors
///
/// Fails on an unknown card type or a bad input shape.
#[wasm_bindgen(js_name = dashboardResolveDeps, unchecked_return_type = "string[]")]
pub fn dashboard_resolve_deps_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] card_types: JsValue,
) -> Result<JsValue, JsError> {
    let types = read_types(card_types)?;
    let refs: Vec<&str> = types.iter().map(String::as_str).collect();
    js(&card_registry::resolve_deps(&refs).map_err(js_error)?)
}

/// [`fit_max_heights`](card_registry::fit_max_heights): each fitted list card's largest height.
///
/// # Errors
///
/// Fails if the map cannot be converted to a JS value.
#[wasm_bindgen(js_name = dashboardFitMaxHeights, unchecked_return_type = "Readonly<Record<string, number>>")]
pub fn dashboard_fit_max_heights_js() -> Result<JsValue, JsError> {
    js(&card_registry::fit_max_heights())
}
