//! Wiki page merge for JavaScript (wf-core `ai::wiki_merge`). The JS name matches
//! `packages/core/src/features/ai-assistant/domain/wiki-merge.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::wiki_merge::{self, MergeInput};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`merge_wiki_pages`](wiki_merge::merge_wiki_pages).
///
/// # Errors
///
/// Fails if `primary` or `secondary` is not a `{ id, title, body, aliases?, sources? }` object.
#[wasm_bindgen(js_name = mergeWikiPages)]
pub fn merge_wiki_pages_js(primary: JsValue, secondary: JsValue) -> JsResult<JsValue> {
    let primary: MergeInput = serde_wasm_bindgen::from_value(primary)?;
    let secondary: MergeInput = serde_wasm_bindgen::from_value(secondary)?;
    to_js(&wiki_merge::merge_wiki_pages(&primary, &secondary))
}
