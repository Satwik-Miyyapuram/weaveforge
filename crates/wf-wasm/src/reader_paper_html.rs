//! Paper HTML framing for JavaScript (`apps/web/src/features/reader/application/paper-html.ts`).
//! Wraps `wf_core::reader::paper_html`, including its thresholds and frame CSP as getters.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::paper_html::{
    MIN_ARTICLE_TEXT_CHARS, MIN_PAPER_TEXT_CHARS, PAPER_HTML_CSP, PaperHtmlOptions, PaperHtmlPage,
    build_paper_html_document, is_substantial_paper_text, parse_paper_html_document,
};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`MIN_PAPER_TEXT_CHARS`]: how much text a page must carry to count as the paper.
#[wasm_bindgen(js_name = minPaperTextChars)]
pub fn min_paper_text_chars_js() -> f64 {
    MIN_PAPER_TEXT_CHARS
}

/// [`MIN_ARTICLE_TEXT_CHARS`]: the text a paper's own web page must carry.
#[wasm_bindgen(js_name = minArticleTextChars)]
pub fn min_article_text_chars_js() -> f64 {
    MIN_ARTICLE_TEXT_CHARS
}

/// [`PAPER_HTML_CSP`]: the frame's own content security policy.
#[wasm_bindgen(js_name = paperHtmlCsp)]
pub fn paper_html_csp_js() -> String {
    PAPER_HTML_CSP.to_string()
}

/// [`is_substantial_paper_text`]: whether the text reaches `min_chars` once whitespace is collapsed.
#[wasm_bindgen(js_name = isSubstantialPaperText)]
pub fn is_substantial_paper_text_js(text: &str, min_chars: f64) -> bool {
    is_substantial_paper_text(text, min_chars)
}

/// [`build_paper_html_document`]: the framed, self-contained document for one kept paper.
///
/// # Errors
///
/// Fails if `page` is not a paper page object, or `options` is not an options object.
#[wasm_bindgen(js_name = buildPaperHtmlDocument)]
pub fn build_paper_html_document_js(page: JsValue, options: JsValue) -> JsResult<String> {
    let page: PaperHtmlPage = serde_wasm_bindgen::from_value(page)?;
    let options: PaperHtmlOptions = serde_wasm_bindgen::from_value(options)?;
    Ok(build_paper_html_document(&page, &options))
}

/// [`parse_paper_html_document`]: the paper a kept file holds, or `null` for a file this app did not write.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = parsePaperHtmlDocument)]
pub fn parse_paper_html_document_js(paper_id: &str, text: &str) -> JsResult<JsValue> {
    to_js(&parse_paper_html_document(paper_id, text))
}
