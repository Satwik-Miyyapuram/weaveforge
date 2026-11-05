//! Reading-list tree for JavaScript (wf-core `reading_lists::reading_list`). The JS names
//! match `packages/core/src/features/reading-lists/domain/reading-list.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reading_lists::reading_list::{self, ReadingList};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`build_list_tree`](reading_list::build_list_tree).
///
/// # Errors
///
/// Fails if `lists` has the wrong shape.
#[wasm_bindgen(js_name = buildListTree)]
pub fn build_list_tree_js(lists: JsValue) -> JsResult<JsValue> {
    let lists: Vec<ReadingList> = serde_wasm_bindgen::from_value(lists)?;
    to_js(&reading_list::build_list_tree(&lists))
}
