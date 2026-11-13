//! Results tables in report notes for JavaScript (wf-core `report::results_table_refs`). The JS
//! names match the TS functions they replace in `apps/web/src/features/report/application/`.
//!
//! The table renderers are not exported. They are only reached through `resolveResultsTables`.

use serde_json::Value;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::report::results_table_refs;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`serialise_results_table_ref`](results_table_refs::serialise_results_table_ref) (TS
/// `serialiseResultsTableRef`).
///
/// # Errors
///
/// Fails if `experiment_ids` is not a list of strings.
#[wasm_bindgen(js_name = serialiseResultsTableRef)]
pub fn serialise_results_table_ref_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] experiment_ids: JsValue,
    caption: Option<String>,
) -> JsResult<String> {
    let experiment_ids: Vec<String> = serde_wasm_bindgen::from_value(experiment_ids)?;
    Ok(results_table_refs::serialise_results_table_ref(
        &experiment_ids,
        caption.as_deref().unwrap_or("Results"),
    ))
}

/// [`parse_results_table_refs`](results_table_refs::parse_results_table_refs) (TS
/// `parseResultsTableRefs`). Offsets are UTF-16 code units.
///
/// # Errors
///
/// Fails if the result cannot be serialised.
#[wasm_bindgen(js_name = parseResultsTableRefs, unchecked_return_type = "{ experimentIds: string[]; caption: string; start: number; end: number; raw: string }[]")]
pub fn parse_results_table_refs_js(markdown: &str) -> JsResult<JsValue> {
    to_js(&results_table_refs::parse_results_table_refs(markdown))
}

/// [`resolve_results_tables`](results_table_refs::resolve_results_tables) (TS
/// `resolveResultsTables`). `format` is `"latex"` for the figure block, anything else for the
/// Markdown table.
///
/// # Errors
///
/// Fails if `experiments` is not a list of experiment objects.
#[wasm_bindgen(js_name = resolveResultsTables)]
pub fn resolve_results_tables_js(
    body: &str,
    #[wasm_bindgen(
        unchecked_param_type = "readonly { id: string; name: string; metrics?: Record<string, unknown> | null }[]"
    )]
    experiments: JsValue,
    #[wasm_bindgen(unchecked_param_type = "\"latex\" | \"markdown\"")] format: &str,
) -> JsResult<String> {
    let experiments: Vec<Value> = serde_wasm_bindgen::from_value(experiments)?;
    Ok(results_table_refs::resolve_results_tables(
        body,
        &experiments,
        format == "latex",
    ))
}
