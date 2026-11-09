//! Reading-list creation and screening verdicts for JavaScript (wf-core `reading_lists`). The JS
//! names match `packages/core/src/features/reading-lists/domain/{reading-list,screening}.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reading_lists::reading_list::{self, NewReadingListInput};
use wf_core::reading_lists::screening::{self, ScreeningDecision, ScreeningItem};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`create_reading_list`](reading_list::create_reading_list) with the id and time supplied.
///
/// # Errors
///
/// Fails if `input` has the wrong shape or the name is blank.
#[wasm_bindgen(js_name = createReadingListWith)]
pub fn create_reading_list_with_js(input: JsValue, id: &str, now: &str) -> JsResult<JsValue> {
    let input: NewReadingListInput = serde_wasm_bindgen::from_value(input)?;
    let made = reading_list::create_reading_list(&input, id, now)
        .map_err(serde_wasm_bindgen::Error::new)?;
    to_js(&made)
}

/// [`verdicts_for`](screening::verdicts_for): both stages' verdicts per item, in item order.
///
/// # Errors
///
/// Fails if `items` or `decisions` have the wrong shape.
#[wasm_bindgen(js_name = verdictsFor)]
pub fn verdicts_for_js(items: JsValue, decisions: JsValue) -> JsResult<JsValue> {
    let items: Vec<ScreeningItem> = serde_wasm_bindgen::from_value(items)?;
    let decisions: Vec<ScreeningDecision> = serde_wasm_bindgen::from_value(decisions)?;
    to_js(&screening::verdicts_for(&items, &decisions))
}
