//! Bibliography reference lookup rules (`apps/web/src/features/reader/application/parts-2.ts`).
//! Wraps `wf_core::reader::reference_lookup`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::reference_lookup::{
    LookupEntry, is_cache_entry_fresh, is_library_listing_fresh, lookup_attempts,
    reference_cache_key, should_store_lookup,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`reference_cache_key`]: the store key of one bibliography entry within one document.
#[wasm_bindgen(js_name = referenceCacheKey)]
pub fn reference_cache_key_js(document_key: &str, ref_index: f64) -> String {
    reference_cache_key(document_key, ref_index)
}

/// [`is_cache_entry_fresh`]: whether a lookup stamped at `storedAt` still answers at `now`.
#[wasm_bindgen(js_name = isReferenceCacheEntryFresh)]
pub fn is_cache_entry_fresh_js(stored_at: f64, now: f64) -> bool {
    is_cache_entry_fresh(stored_at, now)
}

/// [`is_library_listing_fresh`]: whether a library listing taken at `listedAt` still answers at `now`.
#[wasm_bindgen(js_name = isLibraryListingFresh)]
pub fn is_library_listing_fresh_js(listed_at: f64, now: f64) -> bool {
    is_library_listing_fresh(listed_at, now)
}

/// [`should_store_lookup`]: whether a lookup with this status is kept across sessions.
#[wasm_bindgen(js_name = shouldStoreReferenceLookup)]
pub fn should_store_lookup_js(status: &str) -> bool {
    should_store_lookup(status)
}

/// [`lookup_attempts`]: the forms a bibliography entry is offered in, strongest first. Returns
/// `{ kind, value, hints? }[]`; an empty list means the entry is unresolved.
///
/// # Errors
///
/// Fails if `entry` is not a `{ doi, arxivId, title, year, firstAuthor }` object.
#[wasm_bindgen(
    js_name = referenceLookupAttempts,
    unchecked_return_type = "{ kind: \"doi\" | \"arxiv\" | \"bibliographic\"; value: string; hints?: B.ReferenceHints }[]"
)]
pub fn reference_lookup_attempts_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ doi?: string; arxivId?: string; title?: string; year?: number; firstAuthor?: string }"
    )]
    entry: JsValue,
) -> JsResult<JsValue> {
    let entry: LookupEntry = serde_wasm_bindgen::from_value(entry)?;
    to_js(&lookup_attempts(&entry))
}
