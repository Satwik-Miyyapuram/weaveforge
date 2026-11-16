//! Paper-page sanitizer lists and URL resolve for JavaScript
//! (`apps/web/src/features/reader/infrastructure/sanitize-paper-html.ts`). Wraps
//! `wf_core::reader::paper_html_sanitize`; DOMPurify stays in TS.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::reader::paper_html_sanitize::{FORBID_TAGS, chrome_selector, resolve_url};

/// Page-furniture selector list, joined for `querySelectorAll`.
#[wasm_bindgen(js_name = paperHtmlChromeSelector)]
pub fn paper_html_chrome_selector_js() -> String {
    chrome_selector()
}

/// Tags the sanitizer forbids on top of its profile.
#[wasm_bindgen(js_name = paperHtmlForbidTags)]
pub fn paper_html_forbid_tags_js() -> Vec<String> {
    FORBID_TAGS.iter().map(|tag| (*tag).to_string()).collect()
}

/// `new URL(href, base).toString()`; `null` where the constructor would throw.
#[wasm_bindgen(js_name = resolveAbsoluteUrl, unchecked_return_type = "string | null")]
pub fn resolve_absolute_url_js(href: &str, base: &str) -> JsValue {
    resolve_url(href, base).map_or(JsValue::NULL, |url| JsValue::from_str(&url))
}
