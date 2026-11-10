//! Reading-list tree for JavaScript (wf-core `reading_lists::reading_list`). The JS names
//! match `packages/core/src/features/reading-lists/domain/reading-list.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reading_lists::reading_list::{
    self, MembershipItem, MembershipKey, MembershipList, ReadingList,
};

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

/// [`list_display_colour`](reading_list::list_display_colour).
///
/// # Errors
///
/// Fails if `list` has the wrong shape.
#[wasm_bindgen(js_name = listDisplayColor)]
pub fn list_display_colour_js(list: JsValue) -> JsResult<String> {
    let list: ReadingList = serde_wasm_bindgen::from_value(list)?;
    Ok(reading_list::list_display_colour(&list))
}

/// [`list_membership`](reading_list::list_membership) (TS `buildListMembership`). `key` is
/// `"paper"`, `"vaultPage"` or `"either"`. Returns `[listId, resourceIds[]]` pairs in list order.
///
/// # Errors
///
/// Fails if `lists`, `items` or `key` has the wrong shape.
#[wasm_bindgen(js_name = listMembershipByKey)]
pub fn list_membership_by_key_js(
    lists: JsValue,
    items: JsValue,
    key: JsValue,
) -> JsResult<JsValue> {
    let lists: Vec<MembershipList> = serde_wasm_bindgen::from_value(lists)?;
    let items: Vec<MembershipItem> = serde_wasm_bindgen::from_value(items)?;
    let key: MembershipKey = serde_wasm_bindgen::from_value(key)?;
    to_js(&reading_list::list_membership(&lists, &items, key))
}

/// [`deepest_first_list_ids`](reading_list::deepest_first_list_ids) (TS `removeList` order).
///
/// # Errors
///
/// Fails if `lists` has the wrong shape.
#[wasm_bindgen(js_name = deepestFirstListIds)]
pub fn deepest_first_list_ids_js(list_id: &str, lists: JsValue) -> JsResult<Vec<String>> {
    let lists: Vec<ReadingList> = serde_wasm_bindgen::from_value(lists)?;
    Ok(reading_list::deepest_first_list_ids(list_id, &lists))
}
