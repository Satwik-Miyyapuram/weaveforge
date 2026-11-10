//! Reading-list name filter for JavaScript (wf-core `reading_lists::name_filter`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reading_lists::name_filter;

/// [`name_contains`](name_filter::name_contains): whether `name` contains `needle`, ignoring
/// case. An empty `needle` matches every name.
#[wasm_bindgen(js_name = readingListNameMatches)]
pub fn reading_list_name_matches_js(name: &str, needle: &str) -> bool {
    name_filter::name_contains(name, needle)
}
