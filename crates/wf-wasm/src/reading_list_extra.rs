//! Reading-list creation and screening verdicts for JavaScript (wf-core `reading_lists`). The JS
//! names match `packages/core/src/features/reading-lists/domain/{reading-list,screening}.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reading_lists::reading_list::{self, NewReadingListInput};
use wf_core::reading_lists::screening::{self, ScreeningDecision, ScreeningItem};

use super::experiment_member::{dep_text, named_error};
use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`create_reading_list`](reading_list::create_reading_list) with the id and time supplied.
///
/// # Errors
///
/// Fails if `input` has the wrong shape or the name is blank.
#[wasm_bindgen(js_name = createReadingListWith, unchecked_return_type = "B.ReadingList")]
pub fn create_reading_list_with_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] input: JsValue,
    id: &str,
    now: &str,
) -> JsResult<JsValue> {
    let input: NewReadingListInput = serde_wasm_bindgen::from_value(input)?;
    let made = reading_list::create_reading_list(&input, id, now)
        .map_err(serde_wasm_bindgen::Error::new)?;
    to_js(&made)
}

/// A new reading list, its id from `deps.ids.newId()` and then its time from
/// `deps.clock.nowIso()`.
///
/// # Errors
///
/// Throws a `ReadingListValidationError` for a blank name or a wrongly shaped `input`, and
/// rethrows whatever `deps` throws.
#[wasm_bindgen(js_name = createReadingList, unchecked_return_type = "B.ReadingList")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn create_reading_list_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] input: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "{ clock: { nowIso(): string }; ids: { newId(): string } }"
    )]
    deps: JsValue,
) -> Result<JsValue, JsValue> {
    let id = dep_text(&deps, "ids", "newId")?;
    let now = dep_text(&deps, "clock", "nowIso")?;
    create_reading_list_with_js(input, &id, &now)
        .map_err(|error| named_error(error, "ReadingListValidationError"))
}

/// `JSON.stringify(value)`, the copy the screening rules read.
fn json_copy(value: &JsValue) -> Result<JsValue, JsValue> {
    Ok(js_sys::JSON::stringify(value)?.into())
}

/// [`verdicts_for`](screening::verdicts_for): both stages' verdicts per item, in item order.
/// Both lists are read through one `JSON.stringify` copy.
///
/// # Errors
///
/// Fails if `items` or `decisions` cannot be stringified or have the wrong shape.
#[wasm_bindgen(js_name = verdictsFor, unchecked_return_type = "B.ItemVerdict[]")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn verdicts_for_js(
    #[wasm_bindgen(unchecked_param_type = "readonly { id: string }[]")] items: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly unknown[]")] decisions: JsValue,
) -> Result<JsValue, JsValue> {
    let items: Vec<ScreeningItem> = super::screening_records::list_from(json_copy(&items)?)?;
    let decisions: Vec<ScreeningDecision> =
        super::screening_records::list_from(json_copy(&decisions)?)?;
    Ok(to_js(&screening::verdicts_for(&items, &decisions))?)
}
