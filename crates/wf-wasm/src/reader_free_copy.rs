//! "Find a free copy" messages and ids (`apps/web/src/features/reader/application/find-free-copy.ts`).
//! Wraps `wf_core::reader::free_copy`.

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::reader::free_copy::{
    FreeCopyFailure, OpenAccessIds, PaperLinks, describe_free_copy_failure, is_web_article,
    open_access_ids_of,
};

use serde::Serialize;

/// [`describe_free_copy_failure`]: `outcome` is the `"none"` outcome of a search.
///
/// # Errors
///
/// Fails if `outcome` does not have the expected shape.
#[wasm_bindgen(js_name = describeFreeCopyFailure)]
pub fn describe_free_copy_failure_js(
    outcome: JsValue,
    web_article: bool,
) -> Result<String, JsError> {
    let outcome: FreeCopyFailure = serde_wasm_bindgen::from_value(outcome)
        .map_err(|error| JsError::new(&error.to_string()))?;
    Ok(describe_free_copy_failure(&outcome, web_article))
}

/// [`is_web_article`]: `ids` is an `OpenAccessIds`.
///
/// # Errors
///
/// Fails if `ids` does not have the expected shape.
#[wasm_bindgen(js_name = isWebArticle)]
pub fn is_web_article_js(ids: JsValue) -> Result<bool, JsError> {
    let ids: OpenAccessIds =
        serde_wasm_bindgen::from_value(ids).map_err(|error| JsError::new(&error.to_string()))?;
    Ok(is_web_article(&ids))
}

/// [`open_access_ids_of`]: `paper` carries `doi`, `arxivId`, `url` and `metadata`.
///
/// # Errors
///
/// Fails if `paper` does not have the expected shape.
#[wasm_bindgen(js_name = openAccessIdsOf)]
pub fn open_access_ids_of_js(paper: JsValue) -> Result<JsValue, JsError> {
    let paper: PaperLinks =
        serde_wasm_bindgen::from_value(paper).map_err(|error| JsError::new(&error.to_string()))?;
    // Absent ids are `undefined`, as the TypeScript type says, not `null`.
    open_access_ids_of(&paper)
        .serialize(&serde_wasm_bindgen::Serializer::new())
        .map_err(|error| JsError::new(&error.to_string()))
}
