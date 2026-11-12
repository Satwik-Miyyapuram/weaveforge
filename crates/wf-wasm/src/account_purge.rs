//! Blob purge key plan for JavaScript (wf-core `account_purge`). The TS caller keeps the listing,
//! removal and registry calls.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::account_purge;

use super::to_js;

/// [`purges_objects`](account_purge::purges_objects): whether object removal runs.
#[wasm_bindgen(js_name = purgesObjects)]
#[must_use]
pub fn purges_objects_js(provider: &str, row_count: u32) -> bool {
    account_purge::purges_objects(provider, row_count as usize)
}

/// [`STORAGE_LIST_PAGE`](account_purge::STORAGE_LIST_PAGE): entries per storage listing call.
#[wasm_bindgen(js_name = storageListPage)]
#[must_use]
pub fn storage_list_page_js() -> u32 {
    u32::try_from(account_purge::STORAGE_LIST_PAGE).unwrap_or(u32::MAX)
}

/// [`split_storage_listing`](account_purge::split_storage_listing): file keys and folder keys.
///
/// # Errors
///
/// Fails if `entries` is not a list of `{ name, isFile }` or the result cannot become a JS value.
#[wasm_bindgen(js_name = splitStorageListing, unchecked_return_type = "{ files: string[]; folders: string[] }")]
pub fn split_storage_listing_js(
    current: &str,
    entries: wasm_bindgen::JsValue,
) -> Result<wasm_bindgen::JsValue, serde_wasm_bindgen::Error> {
    let entries: Vec<account_purge::ListedEntry> = serde_wasm_bindgen::from_value(entries)?;
    to_js(&account_purge::split_storage_listing(current, &entries))
}

/// [`storage_listing_has_more`](account_purge::storage_listing_has_more): a full page, so page on.
#[wasm_bindgen(js_name = storageListingHasMore)]
#[must_use]
pub fn storage_listing_has_more_js(count: u32) -> bool {
    account_purge::storage_listing_has_more(count as usize)
}

/// [`purge_failure_message`](account_purge::purge_failure_message): the error text when removals fail.
#[wasm_bindgen(js_name = purgeFailureMessage)]
#[must_use]
pub fn purge_failure_message_js(failed: u32, total: u32) -> String {
    account_purge::purge_failure_message(failed as usize, total as usize)
}
