//! Paper relation rules for JavaScript (wf-core `paper_relation`). The JS names match
//! `packages/core/src/features/relations/domain/parts.ts`.
//!
//! `createPaperRelation` draws the id and time from the caller's deps after validation, as the
//! TS function did.

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::relations::graph_settings::RelationType;
use wf_core::relations::paper_relation::{self, NewPaperRelationInput, PaperRelation};

use super::to_js;

/// [`validate_new_paper_relation`](paper_relation::validate_new_paper_relation): the
/// validation message, or `undefined` when the input is valid. An unknown `relation` gets
/// `Unknown relation "<relation>".`, checked first as the TS rule did.
///
/// # Errors
///
/// Fails if `input` is not an object or has the wrong shape.
#[wasm_bindgen(js_name = paperRelationInputError)]
pub fn paper_relation_input_error_js(
    #[wasm_bindgen(unchecked_param_type = "B.NewPaperRelationInput")] input: JsValue,
) -> Result<Option<String>, JsValue> {
    if let Some(message) = unknown_relation_error(&input)? {
        return Ok(Some(message));
    }
    let input: NewPaperRelationInput = serde_wasm_bindgen::from_value(input)?;
    Ok(paper_relation::validate_new_paper_relation(&input).err())
}

/// `Unknown relation "<relation>".` when `input.relation` is not a [`RelationType`].
fn unknown_relation_error(input: &JsValue) -> Result<Option<String>, JsValue> {
    let relation = js_sys::Reflect::get(input, &JsValue::from_str("relation"))?;
    if serde_wasm_bindgen::from_value::<RelationType>(relation.clone()).is_ok() {
        return Ok(None);
    }
    Ok(Some(format!(
        "Unknown relation \"{}\".",
        js_string(&relation)
    )))
}

/// `value` as JS `String(value)` writes it.
fn js_string(value: &JsValue) -> String {
    if value.is_undefined() {
        "undefined".to_owned()
    } else if value.is_null() {
        "null".to_owned()
    } else {
        value
            .as_string()
            .unwrap_or_else(|| value.unchecked_ref::<js_sys::Object>().to_string().into())
    }
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

/// A new relation from caller input: validates it, then draws the id from `deps.ids.newId()`
/// and the time from `deps.clock.nowIso()`, in that order.
///
/// # Errors
///
/// Throws an `Error` named `PaperRelationValidationError` with the validation message before
/// drawing an id; rethrows what `deps` throws.
#[wasm_bindgen(js_name = createPaperRelation, unchecked_return_type = "B.PaperRelation")]
pub fn create_paper_relation_from_deps_js(
    #[wasm_bindgen(unchecked_param_type = "B.NewPaperRelationInput")] input: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "{ clock: { nowIso(): string }; ids: { newId(): string } }"
    )]
    deps: &JsValue,
) -> Result<JsValue, JsValue> {
    if let Some(message) = paper_relation_input_error_js(input.clone())? {
        let error = js_sys::Error::new(&message);
        error.set_name("PaperRelationValidationError");
        return Err(error.into());
    }
    let id = call_dep(deps, "ids", "newId")?;
    let now = call_dep(deps, "clock", "nowIso")?;
    create_paper_relation_js(input, &id, &now)
}

/// `deps[owner][method]()`, called with `deps[owner]` as `this`, read as a string.
fn call_dep(deps: &JsValue, owner: &str, method: &str) -> Result<String, JsValue> {
    let owner = js_sys::Reflect::get(deps, &JsValue::from_str(owner))?;
    let method: js_sys::Function =
        js_sys::Reflect::get(&owner, &JsValue::from_str(method))?.dyn_into()?;
    Ok(method.call0(&owner)?.as_string().unwrap_or_default())
}
