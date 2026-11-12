//! Search ranking rules for JavaScript (wf-core `search_tuning`). The JS names match
//! `packages/core/src/search/parts.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::search_tuning::{self, DocumentBoostOptions, RankedDoc};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`fuzziness_for_term`](search_tuning::fuzziness_for_term).
#[wasm_bindgen(js_name = fuzzinessForTerm)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn fuzziness_for_term_js(term: String) -> f64 {
    search_tuning::fuzziness_for_term(&term)
}

/// [`document_boost`](search_tuning::document_boost). `options.now` is epoch milliseconds and
/// defaults to `Date.now()`; `options` defaults to `{}`.
///
/// # Errors
///
/// Fails if `doc` or `options` has the wrong shape.
#[wasm_bindgen(js_name = documentBoost)]
pub fn document_boost_js(
    #[wasm_bindgen(unchecked_param_type = "{ degree: number; updatedAt: string }")] doc: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.DocumentBoostOptions & { now?: number }")]
    options: JsValue,
) -> JsResult<f64> {
    let doc: RankedDoc = serde_wasm_bindgen::from_value(doc)?;
    let (options, now) = if options.is_undefined() || options.is_null() {
        (DocumentBoostOptions::default(), None)
    } else {
        let now = js_sys::Reflect::get(&options, &JsValue::from_str("now"))
            .ok()
            .and_then(|now| now.as_f64());
        (serde_wasm_bindgen::from_value(options)?, now)
    };
    let now = now.unwrap_or_else(js_sys::Date::now);
    Ok(search_tuning::document_boost(&doc, &options, now))
}
