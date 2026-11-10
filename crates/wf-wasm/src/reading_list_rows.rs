//! Reading-list row mapping for JavaScript (wf-core `reading_lists::list_row`). The TS
//! wrapper in `packages/wf-wasm/src/reading-list-rows.ts` applies the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::reading_lists::list_row::{
    ReadingListItemRow, ReadingListRow, to_item_domain, to_item_row, to_list_domain, to_list_row,
};
use wf_core::reading_lists::reading_list::{ReadingList, ReadingListItem};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// [`to_list_domain`]: a `reading_lists` row as a domain list.
#[wasm_bindgen(js_name = readingListToDomain, unchecked_return_type = "B.ReadingList")]
pub fn reading_list_to_domain_js(
    #[wasm_bindgen(unchecked_param_type = "B.ReadingListRow")] row: JsValue,
) -> Result<JsValue, JsError> {
    let row: ReadingListRow = parse(row)?;
    to_js(&to_list_domain(&row)).map_err(js_error)
}

/// [`to_list_row`]: a domain list as a `reading_lists` row.
#[wasm_bindgen(js_name = readingListToRow, unchecked_return_type = "B.ReadingListRow")]
pub fn reading_list_to_row_js(
    #[wasm_bindgen(unchecked_param_type = "B.ReadingList")] list: JsValue,
) -> Result<JsValue, JsError> {
    let list: ReadingList = parse(list)?;
    to_js(&to_list_row(&list)).map_err(js_error)
}

/// [`to_item_domain`]: a `reading_list_items` row as a domain item.
#[wasm_bindgen(js_name = readingListItemToDomain, unchecked_return_type = "B.ReadingListItem")]
pub fn reading_list_item_to_domain_js(
    #[wasm_bindgen(unchecked_param_type = "B.ReadingListItemRow")] row: JsValue,
) -> Result<JsValue, JsError> {
    let row: ReadingListItemRow = parse(row)?;
    to_js(&to_item_domain(&row)).map_err(js_error)
}

/// [`to_item_row`]: a domain item as a `reading_list_items` row.
#[wasm_bindgen(js_name = readingListItemToRow, unchecked_return_type = "B.ReadingListItemRow")]
pub fn reading_list_item_to_row_js(
    #[wasm_bindgen(unchecked_param_type = "B.ReadingListItem")] item: JsValue,
) -> Result<JsValue, JsError> {
    let item: ReadingListItem = parse(item)?;
    to_js(&to_item_row(&item)).map_err(js_error)
}
