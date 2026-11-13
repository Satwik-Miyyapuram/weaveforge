//! Results-table presence in a report tree (wf-core `report::results_tables_presence`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::report::results_tables_presence::{ResultsTablesTreeNode, has_results_tables};

/// [`has_results_tables`]: whether any section in the report tree, or a descendant, has an
/// `exptable:` reference.
///
/// # Errors
///
/// Fails if `nodes` has the wrong shape.
#[wasm_bindgen(js_name = hasResultsTables)]
pub fn has_results_tables_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ResultsTablesTreeNode[]")] nodes: JsValue,
) -> Result<bool, serde_wasm_bindgen::Error> {
    let nodes: Vec<ResultsTablesTreeNode> = serde_wasm_bindgen::from_value(nodes)?;
    Ok(has_results_tables(&nodes))
}
