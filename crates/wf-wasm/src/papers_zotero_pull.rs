//! Zotero pull join (wf-core `papers::zotero_pull`).

#![allow(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen exports take owned values"
)]
use std::collections::HashSet;

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::papers::zotero_annotations::ZoteroItemRow;
use wf_core::papers::zotero_pull::join_zotero_pull;

use super::to_js;

fn from_js<T: serde::de::DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

/// Joins a pull's attachments, annotations and notes to their papers (TS
/// `ZoteroAnnotations.pull`). `allowedPaperKeys` is `null` for the whole library.
/// Returns `{ byPaper: [key, annotations][], attachments: [paperKey, attKey][], choices: string[] }`.
///
/// # Errors
///
/// Fails if an item is not a Zotero item row or the key list is not strings.
#[wasm_bindgen(
    js_name = zoteroPullJoin,
    unchecked_return_type = "B.ZoteroPullJoin"
)]
pub fn zotero_pull_join_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ZoteroItemRow[]")] attachments: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.ZoteroItemRow[]")] annotations: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.ZoteroItemRow[]")] notes: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[] | null")] allowed_paper_keys: JsValue,
) -> Result<JsValue, JsError> {
    let attachments: Vec<ZoteroItemRow> = from_js(attachments)?;
    let annotations: Vec<ZoteroItemRow> = from_js(annotations)?;
    let notes: Vec<ZoteroItemRow> = from_js(notes)?;
    let allowed: Option<Vec<String>> = from_js(allowed_paper_keys)?;
    let allowed: Option<HashSet<String>> = allowed.map(|keys| keys.into_iter().collect());
    let joined = join_zotero_pull(&attachments, &annotations, &notes, allowed.as_ref());
    to_js(&joined).map_err(|error| JsError::new(&error.to_string()))
}
