//! Overleaf Workshop checks for JavaScript (wf-core `overleaf_workshop`): the session-id shape and
//! the project list the projects route returns. Sorting the list by name stays in TypeScript.

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::JsValue;

use super::to_js;

type JsResult<T> = Result<T, JsValue>;

/// True when `id` has the UUID shape of an Overleaf session id. The caller checks it is a string first.
#[wasm_bindgen(js_name = isWorkshopSessionId)]
pub fn is_workshop_session_id(id: &str) -> bool {
    wf_core::overleaf_workshop::is_session_id(id)
}

/// The `{id, name}` projects in a projects-route body, in the route's order. `null` (or
/// `undefined`, depending on how the empty value is encoded) when `projects` is not an array.
#[wasm_bindgen(js_name = workshopProjectList)]
pub fn workshop_project_list_js(body: JsValue) -> JsResult<JsValue> {
    let body: serde_json::Value = serde_wasm_bindgen::from_value(body)?;
    let projects = wf_core::overleaf_workshop::workshop_projects(&body);
    to_js(&projects).map_err(JsValue::from)
}
