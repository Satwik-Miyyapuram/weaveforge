//! The page an approved proposal created, for JavaScript (wf-core `proposal_created_page`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::proposal_created_page::{self, PageRef, ProposalPreviewItem};

use super::to_js;

/// [`created_page_index`](proposal_created_page::created_page_index). `item` is a proposal with
/// `kind` and `payload`; `pages` is a list of pages with `title` and `parentId`. Returns the
/// index into `pages`, or `null`.
///
/// # Errors
///
/// Fails if an input cannot be read as the expected shape.
#[wasm_bindgen(js_name = createdPageIndex, unchecked_return_type = "number | null")]
pub fn created_page_index_js(
    #[wasm_bindgen(unchecked_param_type = "B.ProposalPreviewItem")] item: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.PageRef[]")] pages: JsValue,
) -> Result<JsValue, JsError> {
    let item: ProposalPreviewItem =
        serde_wasm_bindgen::from_value(item).map_err(|e| JsError::new(&e.to_string()))?;
    let pages: Vec<PageRef> =
        serde_wasm_bindgen::from_value(pages).map_err(|e| JsError::new(&e.to_string()))?;
    to_js(&proposal_created_page::created_page_index(&item, &pages))
        .map_err(|e| JsError::new(&e.to_string()))
}
