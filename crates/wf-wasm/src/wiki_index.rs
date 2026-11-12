//! Wiki index for JavaScript (wf-core `ai::wiki_index`). The JS names match
//! `packages/core/src/features/ai-assistant/domain/wiki-index.ts`.

use js_sys::{Array, Function, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::ai::wiki_index::{self, WikiPageRef};

/// A property of `options`, `undefined` when `options` is missing.
fn option(options: Option<&JsValue>, key: &str) -> Result<JsValue, JsValue> {
    match options {
        Some(options) => Reflect::get(options, &JsValue::from_str(key)),
        None => Ok(JsValue::UNDEFINED),
    }
}

/// [`build_wiki_index`](wiki_index::build_wiki_index): the generated block. `heading` defaults to
/// `Index`; `now` (default: the ISO time) is read only when pages exist, else the stamp is empty.
///
/// # Errors
///
/// Fails if `pages` is not an array of `{ title, aliases? }` objects, `now` throws or does not
/// return a string, or `heading` is not a string.
#[wasm_bindgen(js_name = buildWikiIndex)]
pub fn build_wiki_index_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.WikiPageRef[]")] pages: &Array,
    #[wasm_bindgen(unchecked_optional_param_type = "{ heading?: string; now?: () => string }")]
    options: Option<JsValue>,
) -> Result<String, JsValue> {
    let generated_at = if pages.length() > 0 {
        let now = option(options.as_ref(), "now")?;
        if now.is_undefined() || now.is_null() {
            String::from(js_sys::Date::new_0().to_iso_string())
        } else {
            now.unchecked_into::<Function>()
                .call0(&JsValue::UNDEFINED)?
                .as_string()
                .ok_or_else(|| js_sys::TypeError::new("now() did not return a string"))?
        }
    } else {
        String::new()
    };
    let heading = option(options.as_ref(), "heading")?;
    let heading = if heading.is_undefined() || heading.is_null() {
        None
    } else {
        Some(
            heading
                .as_string()
                .ok_or_else(|| js_sys::TypeError::new("heading is not a string"))?,
        )
    };
    let pages: Vec<WikiPageRef> = serde_wasm_bindgen::from_value(JsValue::from(pages.clone()))?;
    Ok(wiki_index::build_wiki_index(
        &pages,
        heading.as_deref(),
        &generated_at,
    ))
}

/// [`replace_wiki_index`](wiki_index::replace_wiki_index).
#[wasm_bindgen(js_name = replaceWikiIndex)]
pub fn replace_wiki_index_js(body: &str, index: &str) -> String {
    wiki_index::replace_wiki_index(body, index)
}
