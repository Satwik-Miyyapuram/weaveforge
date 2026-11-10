//! Reading-list tree order and subtree grouping for JavaScript (wf-core
//! `reading_lists::{list_order, subtree_items}`). The TS wrappers in
//! `packages/wf-wasm/src/reading-lists-order.ts` apply the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::reading_lists::list_order::{
    collect_list_ids, is_inherited_link_code, item_ids_for_papers, moved_ids, next_sort_order,
    plan_item_order, reordered_ids,
};
use wf_core::reading_lists::reading_list::{ReadingListItem, ReadingListTreeNode};
use wf_core::reading_lists::subtree_items::{group_subtree_items, subtree_ids};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// [`collect_list_ids`]: every list id in the tree, parents before children.
#[wasm_bindgen(js_name = collectListIds)]
pub fn collect_list_ids_js(tree: JsValue) -> Result<JsValue, JsError> {
    let tree: Vec<ReadingListTreeNode> = parse(tree)?;
    to_js(&collect_list_ids(&tree)).map_err(js_error)
}

/// [`reordered_ids`]: `ids` with `dragId` moved into `targetId`'s place, or `undefined`.
#[wasm_bindgen(js_name = reorderedIds)]
pub fn reordered_ids_js(ids: JsValue, drag_id: &str, target_id: &str) -> Result<JsValue, JsError> {
    let ids: Vec<String> = parse(ids)?;
    to_js(&reordered_ids(&ids, drag_id, target_id)).map_err(js_error)
}

/// [`moved_ids`]: `ids` with `id` moved one step (`-1` or `1`), or `undefined` at either end.
#[wasm_bindgen(js_name = movedIds)]
pub fn moved_ids_js(ids: JsValue, id: &str, step: i32) -> Result<JsValue, JsError> {
    let ids: Vec<String> = parse(ids)?;
    to_js(&moved_ids(&ids, id, step)).map_err(js_error)
}

/// [`subtree_ids`]: the id of `node` and of every list below it.
#[wasm_bindgen(js_name = subtreeIds, unchecked_return_type = "string[]")]
pub fn subtree_ids_js(
    #[wasm_bindgen(unchecked_param_type = "B.ReadingListTreeNode")] node: JsValue,
) -> Result<JsValue, JsError> {
    let node: ReadingListTreeNode = parse(node)?;
    to_js(&subtree_ids(&node)).map_err(js_error)
}

/// [`group_subtree_items`]: the subtree's items grouped by list, in subtree order.
#[wasm_bindgen(js_name = groupSubtreeItems)]
pub fn group_subtree_items_js(node: JsValue, items: JsValue) -> Result<JsValue, JsError> {
    let node: ReadingListTreeNode = parse(node)?;
    let items: Vec<ReadingListItem> = parse(items)?;
    to_js(&group_subtree_items(&node, &items)).map_err(js_error)
}

/// [`plan_item_order`]: the writes for a new item order, or the message that refuses it.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[wasm_bindgen(js_name = planItemOrder)]
pub fn plan_item_order_js(
    list_id: &str,
    items: JsValue,
    ordered_ids: Vec<String>,
) -> Result<JsValue, JsError> {
    let items: Vec<ReadingListItem> = parse(items)?;
    to_js(&plan_item_order(list_id, &items, &ordered_ids)).map_err(js_error)
}

/// [`item_ids_for_papers`]: the item id of each paper in order, or the message that refuses it.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[wasm_bindgen(js_name = itemIdsForPapers)]
pub fn item_ids_for_papers_js(
    list_id: &str,
    items: JsValue,
    paper_ids: Vec<String>,
) -> Result<JsValue, JsError> {
    let items: Vec<ReadingListItem> = parse(items)?;
    to_js(&item_ids_for_papers(list_id, &items, &paper_ids)).map_err(js_error)
}

/// [`next_sort_order`]: the sort order a new row gets after `siblings`.
#[wasm_bindgen(js_name = nextSortOrder)]
pub fn next_sort_order_js(siblings: JsValue) -> Result<f64, JsError> {
    let siblings: Vec<ReadingListItem> = parse(siblings)?;
    Ok(next_sort_order(&siblings))
}

/// [`is_inherited_link_code`]: whether a database error code means only the inherited link failed.
#[wasm_bindgen(js_name = isInheritedLinkCode)]
pub fn is_inherited_link_code_js(code: Option<String>) -> bool {
    is_inherited_link_code(code.as_deref())
}
