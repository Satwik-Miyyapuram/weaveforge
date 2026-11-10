//! Tag row mapping for JavaScript (wf-core `tag_row`). The TS wrapper in
//! `packages/wf-wasm/src/tag-rows.ts` applies the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::tag_row::{PaperTagRow, TagRow, to_paper_tag, to_tag};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

#[allow(clippy::needless_pass_by_value)] // `map_err` hands the error over by value.
fn js_error(error: serde_wasm_bindgen::Error) -> JsError {
    JsError::new(&error.to_string())
}

/// [`to_tag`]: a `tags` row as the app's tag.
#[wasm_bindgen(js_name = tagFromRow)]
pub fn tag_from_row_js(row: JsValue) -> Result<JsValue, JsError> {
    let row: TagRow = parse(row)?;
    to_js(&to_tag(&row)).map_err(js_error)
}

/// [`to_paper_tag`]: a `paper_tags` row as the app's paper-tag link.
#[wasm_bindgen(js_name = paperTagFromRow)]
pub fn paper_tag_from_row_js(row: JsValue) -> Result<JsValue, JsError> {
    let row: PaperTagRow = parse(row)?;
    to_js(&to_paper_tag(&row)).map_err(js_error)
}
