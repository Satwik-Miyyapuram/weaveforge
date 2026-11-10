//! Folder-merge rules for JavaScript (step 0b-3). Each export wraps a
//! `wf-core` function; the JS shapes match `packages/core/src/workspace`.

use std::collections::BTreeMap;

use serde_json::{Map, Value};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::frontmatter::{
    frontmatter_list, frontmatter_string, read_frontmatter, write_frontmatter,
};
use wf_core::sync::merge_vault_page::{
    VaultPageBase, VaultPageSide, merge_vault_page, vault_page_base, vault_page_side,
};
use wf_core::sync::text_diff::{HunkPick, merge_hunks, write_conflict_markers};

use super::{check_text, to_js};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`wf_core::sync::merge_vault_page::merge_vault_page`] for JS, as `VaultPageMerge`.
///
/// # Errors
///
/// Fails when a body or the base digest is over `MAX_INDEX_TEXT_UTF16` UTF-16
/// units, or when an argument is not a valid vault page shape.
#[wasm_bindgen(js_name = mergeVaultPage)]
pub fn merge_vault_page_js(
    base: JsValue,
    folder: JsValue,
    workspace: JsValue,
) -> JsResult<JsValue> {
    let base: VaultPageBase = serde_wasm_bindgen::from_value(base)?;
    let folder: VaultPageSide = serde_wasm_bindgen::from_value(folder)?;
    let workspace: VaultPageSide = serde_wasm_bindgen::from_value(workspace)?;
    check_text(&base.body_digest)?;
    check_text(&folder.body)?;
    check_text(&workspace.body)?;
    to_js(&merge_vault_page(&base, &folder, &workspace))
}

/// [`wf_core::sync::merge_vault_page::vault_page_base`] for JS; `null` when the file is not a note.
///
/// # Errors
///
/// Fails when `path` or `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = vaultPageBase)]
pub fn vault_page_base_js(path: &str, content: &str) -> JsResult<JsValue> {
    check_text(path)?;
    check_text(content)?;
    to_js(&vault_page_base(path, content))
}

/// [`wf_core::sync::merge_vault_page::vault_page_side`] for JS; `null` when the file is not a note.
///
/// # Errors
///
/// Fails when `path` or `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = vaultPageSide)]
pub fn vault_page_side_js(path: &str, content: &str) -> JsResult<JsValue> {
    check_text(path)?;
    check_text(content)?;
    to_js(&vault_page_side(path, content))
}

/// [`wf_core::sync::text_diff::merge_hunks`] for JS. Picks are keyed by hunk
/// index; only canonical decimal keys (`"0"`, not `"00"`) count, as in the TS.
///
/// # Errors
///
/// Fails when either text is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when
/// `picks` is not an object of `HunkPick` values.
#[wasm_bindgen(js_name = mergeHunks)]
pub fn merge_hunks_js(ours: &str, theirs: &str, picks: JsValue) -> JsResult<String> {
    check_text(ours)?;
    check_text(theirs)?;
    let picks: BTreeMap<String, HunkPick> = serde_wasm_bindgen::from_value(picks)?;
    let by_index: BTreeMap<usize, HunkPick> = picks
        .into_iter()
        .filter_map(|(key, pick)| match key.parse::<usize>() {
            Ok(n) if n.to_string() == key => Some((n, pick)),
            _ => None,
        })
        .collect();
    Ok(merge_hunks(ours, theirs, &by_index))
}

/// [`wf_core::sync::text_diff::write_conflict_markers`] for JS.
///
/// # Errors
///
/// Fails when either text is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = writeConflictMarkers)]
pub fn write_conflict_markers_js(ours: &str, theirs: &str) -> JsResult<String> {
    check_text(ours)?;
    check_text(theirs)?;
    Ok(write_conflict_markers(ours, theirs))
}

/// [`wf_core::sync::frontmatter::read_frontmatter`] for JS, as `ParsedDocument`.
///
/// # Errors
///
/// Fails when `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = readFrontmatter)]
pub fn read_frontmatter_js(content: &str) -> JsResult<JsValue> {
    check_text(content)?;
    to_js(&read_frontmatter(content))
}

/// [`wf_core::sync::frontmatter::write_frontmatter`] for JS. Fields are written
/// in object key order; a `null` (JS `undefined`) value is skipped, as in the TS.
///
/// # Errors
///
/// Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when
/// `fields` is not an object.
#[wasm_bindgen(js_name = writeFrontmatter)]
pub fn write_frontmatter_js(fields: JsValue, body: &str) -> JsResult<String> {
    check_text(body)?;
    let fields: Map<String, Value> = serde_wasm_bindgen::from_value(fields)?;
    let pairs: Vec<(String, Value)> = fields.into_iter().collect();
    Ok(write_frontmatter(&pairs, body))
}

/// [`frontmatter_string`](wf_core::sync::frontmatter::frontmatter_string) for JS: the
/// field as text, or `undefined` when it is absent, a list, or blank.
///
/// # Errors
///
/// Fails when `frontmatter` is not an object.
#[wasm_bindgen(js_name = frontmatterString)]
pub fn frontmatter_string_js(
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, unknown>>")]
    frontmatter: JsValue,
    key: &str,
) -> JsResult<Option<String>> {
    let fields: Map<String, Value> = serde_wasm_bindgen::from_value(frontmatter)?;
    Ok(frontmatter_string(&fields, key))
}

/// [`frontmatter_list`](wf_core::sync::frontmatter::frontmatter_list) for JS: a list field
/// as its entries as text, or a non-blank scalar string as one entry.
///
/// # Errors
///
/// Fails when `frontmatter` is not an object.
#[wasm_bindgen(js_name = frontmatterList, unchecked_return_type = "string[]")]
pub fn frontmatter_list_js(
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, unknown>>")]
    frontmatter: JsValue,
    key: &str,
) -> JsResult<JsValue> {
    let fields: Map<String, Value> = serde_wasm_bindgen::from_value(frontmatter)?;
    to_js(&frontmatter_list(&fields, key))
}
