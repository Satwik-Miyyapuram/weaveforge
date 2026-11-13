//! Paper-title helpers for JavaScript (wf-core `papers::paper_title`). Each export wraps one function;
//! the JS names match `packages/core/src/features/papers/domain/paper-title.ts`.
//!
//! The TS wrappers in `packages/wf-wasm/src/papers-paper-title.ts` apply the `null` and `undefined` handling.

use wasm_bindgen::{JsValue, prelude::wasm_bindgen};
use wf_core::papers::paper_title;

/// [`is_placeholder_title`](paper_title::is_placeholder_title) (TS `isPlaceholderTitle`).
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[wasm_bindgen(js_name = isPlaceholderTitle)]
#[must_use]
pub fn is_placeholder_title_js(
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] title: Option<
        String,
    >,
) -> bool {
    paper_title::is_placeholder_title(title.as_deref())
}

/// [`title_from_file_name`](paper_title::title_from_file_name) (TS `titleFromFileName`).
#[wasm_bindgen(js_name = titleFromFileName)]
#[must_use]
pub fn title_from_file_name_js(title: &str) -> String {
    paper_title::title_from_file_name(title)
}

/// [`title_key`](paper_title::title_key) (TS `titleKey`). `None` becomes `null` in JS.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
#[wasm_bindgen(js_name = titleKey, unchecked_return_type = "string | null")]
#[must_use]
pub fn title_key_js(
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] title: Option<
        String,
    >,
) -> JsValue {
    paper_title::title_key(title.as_deref()).map_or(JsValue::NULL, JsValue::from)
}
