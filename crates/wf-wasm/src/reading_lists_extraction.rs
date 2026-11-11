//! Extraction-table rules for JavaScript (wf-core `reading_lists::extraction_table`). The TS
//! wrappers in `packages/wf-wasm/src/wrappers-8.ts` apply the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::papers::compute_rollup::RollupValue;
use wf_core::reading_lists::extraction_rows::flatten_paper_rows;
use wf_core::reading_lists::extraction_table::{
    ExtractionFieldDef, ExtractionProposal, ExtractionRow, ProposeFillInput,
    build_propose_fill_prompt, empty_cell_paper_ids, extraction_csv, extraction_markdown,
    pending_field_fills,
};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

/// [`flatten_paper_rows`]: the listed papers that exist, each with its index in `known_ids` and
/// its stored and rollup values, in list order.
#[wasm_bindgen(
    js_name = flattenPaperRows,
    unchecked_return_type = "{ paperIndex: number; values: B.ExtractionValues[\"values\"] }[]"
)]
pub fn flatten_paper_rows_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] known_ids: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] paper_ids: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.RollupValue[]")] values: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.ExtractionFieldDef[]")] defs: JsValue,
) -> Result<JsValue, JsError> {
    let known_ids: Vec<String> = parse(known_ids)?;
    let paper_ids: Vec<String> = parse(paper_ids)?;
    let values: Vec<RollupValue> = parse(values)?;
    let defs: Vec<ExtractionFieldDef> = parse(defs)?;
    let rows = flatten_paper_rows(&known_ids, &paper_ids, &values, &defs);
    to_js(&rows).map_err(|error| JsError::new(&error.to_string()))
}

/// [`extraction_markdown`]: the table as a Markdown table.
#[wasm_bindgen(js_name = extractionMarkdown)]
pub fn extraction_markdown_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ExtractionRow[]")] rows: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.ExtractionFieldDef[]")] defs: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] columns: JsValue,
) -> Result<String, JsError> {
    let rows: Vec<ExtractionRow> = parse(rows)?;
    let defs: Vec<ExtractionFieldDef> = parse(defs)?;
    let columns: Vec<String> = parse(columns)?;
    Ok(extraction_markdown(&rows, &defs, &columns))
}

/// [`extraction_csv`]: the table as CSV, with a header line.
#[wasm_bindgen(js_name = extractionCsv)]
pub fn extraction_csv_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ExtractionRow[]")] rows: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.ExtractionFieldDef[]")] defs: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] columns: JsValue,
) -> Result<String, JsError> {
    let rows: Vec<ExtractionRow> = parse(rows)?;
    let defs: Vec<ExtractionFieldDef> = parse(defs)?;
    let columns: Vec<String> = parse(columns)?;
    Ok(extraction_csv(&rows, &defs, &columns))
}

/// [`empty_cell_paper_ids`]: the papers whose cell for `field_id` is empty and not pending.
#[wasm_bindgen(js_name = emptyCellPaperIds, unchecked_return_type = "string[]")]
pub fn empty_cell_paper_ids_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ExtractionRow[]")] rows: JsValue,
    field_id: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] pending_paper_ids: JsValue,
) -> Result<JsValue, JsError> {
    let rows: Vec<ExtractionRow> = parse(rows)?;
    let pending: Vec<String> = parse(pending_paper_ids)?;
    let ids = empty_cell_paper_ids(&rows, field_id, &pending);
    to_js(&ids).map_err(|error| JsError::new(&error.to_string()))
}

/// [`build_propose_fill_prompt`]: the prompt that asks the AI to fill one column.
#[wasm_bindgen(js_name = buildProposeFillPrompt)]
pub fn build_propose_fill_prompt_js(
    #[wasm_bindgen(unchecked_param_type = "B.ProposeFillInput")] input: JsValue,
) -> Result<String, JsError> {
    let input: ProposeFillInput = parse(input)?;
    Ok(build_propose_fill_prompt(&input))
}

/// [`pending_field_fills`]: the pending `paper_field_value` proposals, optionally for one field.
#[wasm_bindgen(
    js_name = pendingFieldFills,
    unchecked_return_type = "B.ExtractionPendingFill[]"
)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen takes an optional string by value from JS"
)]
pub fn pending_field_fills_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ExtractionProposal[]")] proposals: JsValue,
    field_id: Option<String>,
) -> Result<JsValue, JsError> {
    let proposals: Vec<ExtractionProposal> = parse(proposals)?;
    let fills = pending_field_fills(&proposals, field_id.as_deref());
    to_js(&fills).map_err(|error| JsError::new(&error.to_string()))
}
