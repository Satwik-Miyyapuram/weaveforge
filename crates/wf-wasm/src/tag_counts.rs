//! Paper counts per tag for JavaScript (wf-core `tag_counts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::tag_counts::{self, TagPaperLink};

use super::to_js;

type JsResult<T> = Result<T, JsValue>;

/// [`paper_counts_for_tags`](tag_counts::paper_counts_for_tags): one count per `tagIds` entry, in order.
///
/// # Errors
///
/// Fails if `tagIds` or `links` has the wrong shape.
#[wasm_bindgen(js_name = paperCountsForTags)]
pub fn paper_counts_for_tags_js(tag_ids: JsValue, links: JsValue) -> JsResult<JsValue> {
    let tag_ids: Vec<String> = serde_wasm_bindgen::from_value(tag_ids).map_err(JsValue::from)?;
    let links: Vec<TagPaperLink> = serde_wasm_bindgen::from_value(links).map_err(JsValue::from)?;
    to_js(&tag_counts::paper_counts_for_tags(&tag_ids, &links)).map_err(JsValue::from)
}
