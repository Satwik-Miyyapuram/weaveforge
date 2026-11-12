//! Reading-list tree for JavaScript (wf-core `reading_lists::reading_list`). The JS names
//! match `packages/core/src/features/reading-lists/domain/parts.ts`.

use js_sys::{Map, Set};
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
#[wasm_bindgen(js_name = buildListTree, unchecked_return_type = "B.ReadingListTreeNode[]")]
pub fn build_list_tree_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ReadingList[]")] lists: JsValue,
) -> JsResult<JsValue> {
    let lists: Vec<ReadingList> = serde_wasm_bindgen::from_value(lists)?;
    to_js(&reading_list::build_list_tree(&lists))
}

/// [`list_display_colour`](reading_list::list_display_colour).
///
/// # Errors
///
/// Fails if `list` has the wrong shape.
#[wasm_bindgen(js_name = listDisplayColor)]
pub fn list_display_colour_js(
    #[wasm_bindgen(unchecked_param_type = "B.ReadingList")] list: JsValue,
) -> JsResult<String> {
    let list: ReadingList = serde_wasm_bindgen::from_value(list)?;
    Ok(reading_list::list_display_colour(&list))
}

/// [`list_membership`](reading_list::list_membership) (TS `buildListMembership`): which list
/// holds which resource, `listId -> the ids in it`, in list order. Every list gets an entry,
/// including the empty ones. `key` is `"paper"`, `"vaultPage"` or `"either"`.
///
/// # Errors
///
/// Fails if `lists`, `items` or `key` has the wrong shape.
#[wasm_bindgen(js_name = listMembershipByKey, unchecked_return_type = "Map<string, Set<string>>")]
pub fn list_membership_by_key_js(
    #[wasm_bindgen(unchecked_param_type = "readonly { id: string }[]")] lists: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "readonly { listId: string; paperId?: string | null; vaultPageId?: string | null }[]"
    )]
    items: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.ListMembershipKey")] key: JsValue,
) -> JsResult<JsValue> {
    let lists: Vec<MembershipList> = serde_wasm_bindgen::from_value(lists)?;
    let items: Vec<MembershipItem> = serde_wasm_bindgen::from_value(items)?;
    let key: MembershipKey = serde_wasm_bindgen::from_value(key)?;
    let out = Map::new();
    for (list_id, ids) in reading_list::list_membership(&lists, &items, key) {
        let set = Set::new(&JsValue::UNDEFINED);
        for id in ids {
            let _ = set.add(&JsValue::from(id));
        }
        let _ = out.set(&JsValue::from(list_id), &set);
    }
    Ok(out.into())
}

/// [`deepest_first_list_ids`](reading_list::deepest_first_list_ids) (TS `removeList` order).
///
/// # Errors
///
/// Fails if `lists` has the wrong shape.
#[wasm_bindgen(js_name = deepestFirstListIds)]
pub fn deepest_first_list_ids_js(
    list_id: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly B.ReadingList[]")] lists: JsValue,
) -> JsResult<Vec<String>> {
    let lists: Vec<ReadingList> = serde_wasm_bindgen::from_value(lists)?;
    Ok(reading_list::deepest_first_list_ids(list_id, &lists))
}
