//! Wiki index for JavaScript (wf-core `ai::wiki_index`). The JS names match
//! `packages/core/src/features/ai-assistant/domain/wiki-index.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::wiki_index::{self, WikiPageRef};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`build_wiki_index`](wiki_index::build_wiki_index); `heading` defaults to `Index` when `undefined`.
///
/// # Errors
///
/// Fails if `pages` is not an array of `{ title, aliases? }` objects.
#[wasm_bindgen(js_name = buildWikiIndex)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs an owned Option<String>.
pub fn build_wiki_index_js(
    pages: JsValue,
    heading: Option<String>,
    generated_at: &str,
) -> JsResult<String> {
    let pages: Vec<WikiPageRef> = serde_wasm_bindgen::from_value(pages)?;
    Ok(wiki_index::build_wiki_index(
        &pages,
        heading.as_deref(),
        generated_at,
    ))
}

/// [`replace_wiki_index`](wiki_index::replace_wiki_index).
#[wasm_bindgen(js_name = replaceWikiIndex)]
pub fn replace_wiki_index_js(body: &str, index: &str) -> String {
    wiki_index::replace_wiki_index(body, index)
}
