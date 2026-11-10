//! The Overleaf project list rules (wf-core `overleaf::project_list`). The TS wrapper
//! `packages/wf-wasm/src/overleaf-project-list.ts` gives the raw exports their types.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::overleaf::project_list::{self, AccountProject, LinkedRef};

/// [`merge`](project_list::merge): account projects and linked reports as one list of rows.
///
/// # Errors
///
/// Returns the deserialization error when either argument is not an array of the expected shape.
#[wasm_bindgen(js_name = mergeOverleafProjects)]
pub fn merge_overleaf_projects(account: JsValue, linked: JsValue) -> Result<JsValue, JsValue> {
    let account: Vec<AccountProject> = serde_wasm_bindgen::from_value(account)?;
    let linked: Vec<LinkedRef> = serde_wasm_bindgen::from_value(linked)?;
    Ok(crate::to_js(&project_list::merge(&account, &linked))?)
}

/// [`matches_query`](project_list::matches_query): whether a row matches the search text.
#[wasm_bindgen(js_name = overleafProjectMatches)]
pub fn overleaf_project_matches(name: &str, linked_title: Option<String>, query: &str) -> bool {
    project_list::matches_query(name, linked_title.as_deref(), query)
}

/// [`is_shown`](project_list::is_shown): whether a row is shown given the picked ids.
///
/// # Errors
///
/// Returns the deserialization error when `picked` is not an array of strings.
#[wasm_bindgen(js_name = overleafProjectShown)]
pub fn overleaf_project_shown(has_link: bool, id: &str, picked: JsValue) -> Result<bool, JsValue> {
    let picked: Vec<String> = serde_wasm_bindgen::from_value(picked)?;
    Ok(project_list::is_shown(has_link, id, &picked))
}
