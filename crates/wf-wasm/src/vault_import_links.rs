//! Notes import helpers (wf-core `vault::import_links`): the wikilink rewrite after titles are
//! auto-suffixed, and the file-name filter for an import.

use std::collections::BTreeMap;

use js_sys::{Array, Map, Object, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::vault::import_links;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`rewrite_wikilinks`](import_links::rewrite_wikilinks): rewrite `[[Old]]`, `[[Old|alias]]` and
/// `[[Old#heading]]` when import renamed `Old`. `renames` maps a normalised old title to its new
/// title.
///
/// # Errors
///
/// Fails if `renames` is not a map of strings to strings.
#[wasm_bindgen(js_name = rewriteWikilinks)]
pub fn rewrite_wikilinks_js(
    body: &str,
    #[wasm_bindgen(unchecked_param_type = "ReadonlyMap<string, string>")] renames: &JsValue,
) -> Result<String, JsValue> {
    let renames: BTreeMap<String, String> =
        serde_wasm_bindgen::from_value(Object::from_entries(renames)?.into())?;
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

/// [`plan_import_titles`](import_links::plan_import_titles): the titles an import gives its
/// folders and notes against the existing titles, the renames it made, and `renameMap` (a `Map`
/// from normalised base name to new title, for [`rewriteWikilinks`](rewrite_wikilinks_js)).
///
/// # Errors
///
/// Fails only if the plan cannot be converted to a JS value.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[wasm_bindgen(
    js_name = planImportTitles,
    unchecked_return_type = "{ readonly folderTitles: readonly string[]; readonly noteTitles: readonly string[]; readonly renamed: readonly { readonly from: string; readonly to: string }[]; readonly renameMap: ReadonlyMap<string, string> }"
)]
pub fn plan_import_titles_js(
    #[wasm_bindgen(js_name = folderKeys, unchecked_param_type = "readonly string[]")]
    folder_keys: Vec<String>,
    #[wasm_bindgen(js_name = noteNames, unchecked_param_type = "readonly string[]")]
    note_names: Vec<String>,
    #[wasm_bindgen(js_name = existingTitles, unchecked_param_type = "readonly string[]")]
    existing_titles: Vec<String>,
) -> Result<JsValue, JsValue> {
    let plan = import_links::plan_import_titles(&folder_keys, &note_names, &existing_titles);
    let rename_map = Map::new();
    let entries: Object = to_js(&plan.rename_map)?.unchecked_into();
    for entry in Object::entries(&entries).iter() {
        let pair: Array = entry.unchecked_into();
        let _ = rename_map.set(&pair.get(0), &pair.get(1));
    }
    let out = Object::new();
    let _ = Reflect::set(&out, &"folderTitles".into(), &to_js(&plan.folder_titles)?)?;
    let _ = Reflect::set(&out, &"noteTitles".into(), &to_js(&plan.note_titles)?)?;
    let _ = Reflect::set(&out, &"renamed".into(), &to_js(&plan.renamed)?)?;
    let _ = Reflect::set(&out, &"renameMap".into(), &rename_map)?;
    Ok(out.into())
}
