//! Paper relation rules for JavaScript (wf-core `paper_relation`). The JS names match
//! `packages/core/src/features/relations/domain/parts.ts`.
//!
//! The TS wrapper in `packages/wf-wasm/src/wrappers-5.ts` draws the id and time, after
//! validation, as the TS function does.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::paper_relation::{self, NewPaperRelationInput, PaperRelation};

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
#[wasm_bindgen(js_name = createPaperRelationWith, unchecked_return_type = "B.PaperRelation")]
pub fn create_paper_relation_js(
    #[wasm_bindgen(unchecked_param_type = "B.NewPaperRelationInput")] input: JsValue,
    id: &str,
    created_at: &str,
) -> Result<JsValue, JsValue> {
    let input: NewPaperRelationInput = serde_wasm_bindgen::from_value(input)?;
    let relation: PaperRelation = paper_relation::create_paper_relation(&input, id, created_at)
        .map_err(|message| JsValue::from_str(&message))?;
    Ok(to_js(&relation)?)
}
