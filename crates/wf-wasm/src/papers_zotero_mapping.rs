//! Zotero item <-> paper mapping (wf-core `papers::zotero_mapping`). The TS wrappers in
//! `packages/wf-wasm/src/papers-zotero-mapping.ts` re-export the generated types.

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::papers::paper_merge::MergePaper;
use wf_core::papers::zotero_mapping::{
    ZoteroItem, to_zotero_item, zotero_arxiv_id, zotero_content_keys, zotero_remote_to_input,
    zotero_remote_to_metadata,
};

use super::to_js;

fn from_js<T: serde::de::DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

fn out<T: serde::Serialize>(value: &T) -> Result<JsValue, JsError> {
    to_js(value).map_err(|error| JsError::new(&error.to_string()))
}

/// [`zotero_arxiv_id`] (TS `zoteroArxivId`). The arXiv id of a Zotero item, or null.
///
/// # Errors
///
/// Fails if `item` is not a Zotero item.
#[wasm_bindgen(js_name = zoteroArxivId)]
pub fn zotero_arxiv_id_js(item: JsValue) -> Result<JsValue, JsError> {
    let item: ZoteroItem = from_js(item)?;
    out(&zotero_arxiv_id(&item))
}

/// [`zotero_content_keys`] (TS `zoteroContentKeys`). The keys a paper matches on.
#[wasm_bindgen(js_name = zoteroContentKeys)]
pub fn zotero_content_keys_js(
    doi: Option<String>,
    arxiv_id: Option<String>,
    title: Option<String>,
) -> Result<JsValue, JsError> {
    out(&zotero_content_keys(
        doi.as_deref(),
        arxiv_id.as_deref(),
        title.as_deref(),
    ))
}

/// [`zotero_remote_to_input`] (TS `zoteroRemoteToInput`). A paper read from a Zotero item,
/// with its key kept under `metadata.zoteroKey`.
///
/// # Errors
///
/// Fails if `item` is not a Zotero item.
#[wasm_bindgen(js_name = zoteroRemoteToInput)]
pub fn zotero_remote_to_input_js(item: JsValue) -> Result<JsValue, JsError> {
    let item: ZoteroItem = from_js(item)?;
    out(&zotero_remote_to_input(&item))
}

/// [`zotero_remote_to_metadata`] (TS `zoteroRemoteToMetadata`). The metadata a metadata
/// lookup returns for a Zotero item.
///
/// # Errors
///
/// Fails if `item` is not a Zotero item.
#[wasm_bindgen(js_name = zoteroRemoteToMetadata)]
pub fn zotero_remote_to_metadata_js(item: JsValue) -> Result<JsValue, JsError> {
    let item: ZoteroItem = from_js(item)?;
    out(&zotero_remote_to_metadata(&item))
}

/// [`to_zotero_item`] (TS `toZoteroItem`). The `journalArticle` written to Zotero for a paper.
///
/// # Errors
///
/// Fails if `paper` is not a paper.
#[wasm_bindgen(js_name = toZoteroItem)]
pub fn to_zotero_item_js(paper: JsValue) -> Result<JsValue, JsError> {
    let paper: MergePaper = from_js(paper)?;
    out(&to_zotero_item(&paper))
}
