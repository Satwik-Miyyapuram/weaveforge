//! Paper, paper field and annotation quotation type row mapping for JavaScript (wf-core
//! `papers::{paper_row, paper_field_row, annotation_quotation_type_row}`). The TS wrappers in
//! `packages/wf-wasm/src/wrappers-5.ts` apply the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::papers::annotation_quotation_type_row::{AnnotationQuotationTypeRow, to_domain};
use wf_core::papers::paper_field_row::{
    PaperFieldDefRow, PaperFieldValueRow, to_def_domain, to_value_domain,
};
use wf_core::papers::paper_row::{
    Paper, PaperRow, empty_to_null, paper_to_domain, paper_to_row, paper_to_summary,
};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// [`paper_to_domain`]: a `papers` row as a domain paper.
#[wasm_bindgen(js_name = paperRowToDomain, unchecked_return_type = "B.Paper")]
pub fn paper_row_to_domain_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaperRow")] row: JsValue,
) -> Result<JsValue, JsError> {
    let row: PaperRow = parse(row)?;
    to_js(&paper_to_domain(row)).map_err(js_error)
}

/// [`paper_to_summary`]: a `papers` row read with the card projection, as a summary.
#[wasm_bindgen(js_name = paperRowToSummary, unchecked_return_type = "B.PaperSummary")]
pub fn paper_row_to_summary_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaperRow")] row: JsValue,
) -> Result<JsValue, JsError> {
    let row: PaperRow = parse(row)?;
    to_js(&paper_to_summary(row)).map_err(js_error)
}

/// [`paper_to_row`]: a domain paper as the `papers` row it is written as.
#[wasm_bindgen(js_name = paperToRow, unchecked_return_type = "B.PaperRow")]
pub fn paper_to_row_js(
    #[wasm_bindgen(unchecked_param_type = "B.Paper")] paper: JsValue,
) -> Result<JsValue, JsError> {
    let paper: Paper = parse(paper)?;
    to_js(&paper_to_row(paper)).map_err(js_error)
}

/// [`empty_to_null`]: the text as stored, with an absent or empty value as `null`.
#[wasm_bindgen(js_name = emptyToNull)]
pub fn empty_to_null_js(value: Option<String>) -> Result<JsValue, JsError> {
    to_js(&empty_to_null(value)).map_err(js_error)
}

/// [`to_def_domain`]: a `paper_fields` row as a domain field definition.
#[wasm_bindgen(js_name = paperFieldDefRowToDomain, unchecked_return_type = "B.PaperFieldDef")]
pub fn paper_field_def_row_to_domain_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaperFieldDefRow")] row: JsValue,
) -> Result<JsValue, JsError> {
    let row: PaperFieldDefRow = parse(row)?;
    to_js(&to_def_domain(row)).map_err(js_error)
}

/// [`to_value_domain`]: a `paper_field_values` row as a domain value. Throws on a bad payload.
#[wasm_bindgen(js_name = paperFieldValueRowToDomain, unchecked_return_type = "B.PaperFieldValue")]
pub fn paper_field_value_row_to_domain_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaperFieldValueRow")] row: JsValue,
) -> Result<JsValue, JsError> {
    let row: PaperFieldValueRow = parse(row)?;
    let value = to_value_domain(row).map_err(|message| JsError::new(&message))?;
    to_js(&value).map_err(js_error)
}

/// [`to_domain`]: an `annotation_quotation_types` row as a domain value. Throws on an unknown type.
#[wasm_bindgen(js_name = annotationQuotationTypeRowToDomain, unchecked_return_type = "B.AnnotationQuotationType")]
pub fn annotation_quotation_type_row_to_domain_js(
    #[wasm_bindgen(unchecked_param_type = "B.AnnotationQuotationTypeRow")] row: JsValue,
) -> Result<JsValue, JsError> {
    let row: AnnotationQuotationTypeRow = parse(row)?;
    let value = to_domain(row).map_err(|message| JsError::new(&message))?;
    to_js(&value).map_err(js_error)
}
