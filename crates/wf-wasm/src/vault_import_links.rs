//! Notes import helpers (wf-core `vault::import_links`). The TS wrappers in
//! `packages/wf-wasm/src/vault-import-links.ts` build the rename map from normalised titles.

use std::collections::BTreeMap;

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::vault::import_links;

use super::to_js;

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

/// [`with_tag_line`](import_links::with_tag_line). `tags` is an array of tag names.
///
/// # Errors
///
/// Fails if `tags` is not an array of strings.
#[wasm_bindgen(js_name = withTagLine)]
pub fn with_tag_line_js(
    body: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] tags: JsValue,
) -> JsResult<String> {
    let tags: Vec<String> = serde_wasm_bindgen::from_value(tags)?;
    Ok(import_links::with_tag_line(body, &tags))
}

/// [`is_note_import_file`](import_links::is_note_import_file).
#[wasm_bindgen(js_name = isNoteImportFile)]
#[must_use]
pub fn is_note_import_file_js(name: &str) -> bool {
    import_links::is_note_import_file(name)
}

/// [`is_markdown_file`](import_links::is_markdown_file).
#[wasm_bindgen(js_name = isMarkdownFile)]
#[must_use]
pub fn is_markdown_file_js(name: &str) -> bool {
    import_links::is_markdown_file(name)
}

/// [`is_zip_file`](import_links::is_zip_file).
#[wasm_bindgen(js_name = isZipFile)]
#[must_use]
pub fn is_zip_file_js(name: &str) -> bool {
    import_links::is_zip_file(name)
}

/// [`import_relative_path`](import_links::import_relative_path). An empty `webkit_relative_path`
/// means unset.
#[wasm_bindgen(js_name = importRelativePath)]
#[must_use]
pub fn import_relative_path_js(webkit_relative_path: &str, name: &str) -> String {
    import_links::import_relative_path(webkit_relative_path, name)
}

/// [`plan_import_titles`](import_links::plan_import_titles): the folder and note titles, the
/// renames and the rename map, as a plain object.
///
/// # Errors
///
/// Fails only if the plan cannot be converted to a JS value.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[wasm_bindgen(js_name = planImportTitles)]
pub fn plan_import_titles_js(
    folder_keys: Vec<String>,
    note_names: Vec<String>,
    existing_titles: Vec<String>,
) -> JsResult<JsValue> {
    to_js(&import_links::plan_import_titles(
        &folder_keys,
        &note_names,
        &existing_titles,
    ))
}
