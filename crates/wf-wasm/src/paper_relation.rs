//! Paper relation rules for JavaScript (wf-core `paper_relation`). The JS names match
//! `packages/core/src/features/relations/domain/paper-relation.ts`.
//!
//! The TS wrapper in `packages/wf-wasm/src/paper-relation.ts` draws the id and time, after
//! validation, as the TS function does.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::paper_relation::{
    self, NewPaperRelationInput, PaperRelation, PaperRelationRow,
};
use wf_core::relations::relation_rows;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`validate_new_paper_relation`](paper_relation::validate_new_paper_relation): the
/// validation message, or `undefined` when the input is valid.
///
/// # Errors
///
/// Fails if `input` has the wrong shape.
#[wasm_bindgen(js_name = paperRelationInputError)]
pub fn paper_relation_input_error_js(input: JsValue) -> JsResult<Option<String>> {
    let input: NewPaperRelationInput = serde_wasm_bindgen::from_value(input)?;
    Ok(paper_relation::validate_new_paper_relation(&input).err())
}

/// [`create_paper_relation`](paper_relation::create_paper_relation) with the id and time
/// supplied. Call [`paper_relation_input_error_js`] first: invalid input fails here.
///
/// # Errors
///
/// Fails if `input` has the wrong shape or does not validate.
#[wasm_bindgen(js_name = createPaperRelationWith)]
pub fn create_paper_relation_js(
    input: JsValue,
    id: &str,
    created_at: &str,
) -> Result<JsValue, JsValue> {
    let input: NewPaperRelationInput = serde_wasm_bindgen::from_value(input)?;
    let relation: PaperRelation = paper_relation::create_paper_relation(&input, id, created_at)
        .map_err(|message| JsValue::from_str(&message))?;
    Ok(to_js(&relation)?)
}

/// [`paper_relation_from_row`](paper_relation::paper_relation_from_row): the domain relation
/// for a stored row (a null note reads as absent).
///
/// # Errors
///
/// Fails if `row` has the wrong shape.
#[wasm_bindgen(js_name = paperRelationFromRow, unchecked_return_type = "B.PaperRelation")]
pub fn paper_relation_from_row_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaperRelationRow")] row: JsValue,
) -> Result<JsValue, JsValue> {
    let row: PaperRelationRow = serde_wasm_bindgen::from_value(row)?;
    Ok(to_js(&paper_relation::paper_relation_from_row(row))?)
}

/// [`paper_relation_to_row`](paper_relation::paper_relation_to_row): the stored row for a
/// relation (an absent note is stored as null).
///
/// # Errors
///
/// Fails if `relation` has the wrong shape.
#[wasm_bindgen(js_name = paperRelationToRow, unchecked_return_type = "B.PaperRelationRow")]
pub fn paper_relation_to_row_js(
    #[wasm_bindgen(unchecked_param_type = "B.PaperRelation")] relation: JsValue,
) -> Result<JsValue, JsValue> {
    let relation: PaperRelation = serde_wasm_bindgen::from_value(relation)?;
    Ok(to_js(&paper_relation::paper_relation_to_row(relation))?)
}

/// [`dedupe_relation_rows_by_id`](relation_rows::dedupe_relation_rows_by_id): one row per id,
/// in first-seen order, so a relation on both sides of a paper appears once.
///
/// # Errors
///
/// Fails if `rows` has the wrong shape.
#[wasm_bindgen(js_name = dedupePaperRelationRows, unchecked_return_type = "B.PaperRelationRow[]")]
pub fn dedupe_paper_relation_rows_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.PaperRelationRow[]")] rows: JsValue,
) -> Result<JsValue, JsValue> {
    let rows: Vec<PaperRelationRow> = serde_wasm_bindgen::from_value(rows)?;
    Ok(to_js(&relation_rows::dedupe_relation_rows_by_id(rows))?)
}
