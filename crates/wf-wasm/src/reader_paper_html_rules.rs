//! Paper HTML relay rules for JavaScript (`apps/web/src/features/reader/application/paper-html-rules.ts`).
//! Wraps `wf_core::reader::paper_html_rules`. Byte decoding stays in TS.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::paper_html_rules::{declared_charset, is_html_content_type};

/// [`is_html_content_type`]: whether a response counts as a web page.
#[wasm_bindgen(js_name = isHtmlContentType)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn is_html_content_type_js(value: Option<String>) -> bool {
    is_html_content_type(value.as_deref())
}

/// [`declared_charset`]: the charset a page declares, lowercased, else `utf-8`.
#[wasm_bindgen(js_name = declaredCharset)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn declared_charset_js(content_type: Option<String>, bytes: &[u8]) -> String {
    declared_charset(content_type.as_deref(), bytes)
}
