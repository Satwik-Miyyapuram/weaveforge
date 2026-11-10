//! Notes import helpers (wf-core `vault::import_links`). The TS wrappers in
//! `packages/wf-wasm/src/vault-import-links.ts` build the rename map from normalised titles.

use std::collections::BTreeMap;

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::vault::import_links;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`rewrite_wikilinks`](import_links::rewrite_wikilinks). `renames` is a plain JS object mapping a
/// normalised old title to its new title.
///
/// # Errors
///
/// Fails if `renames` is not an object of string values.
#[wasm_bindgen(js_name = rewriteWikilinks)]
pub fn rewrite_wikilinks_js(body: &str, renames: JsValue) -> JsResult<String> {
    let renames: BTreeMap<String, String> = serde_wasm_bindgen::from_value(renames)?;
    Ok(import_links::rewrite_wikilinks(body, &renames))
}

/// [`is_note_import_file`](import_links::is_note_import_file).
#[wasm_bindgen(js_name = isNoteImportFile)]
#[must_use]
pub fn is_note_import_file_js(name: &str) -> bool {
    import_links::is_note_import_file(name)
}
