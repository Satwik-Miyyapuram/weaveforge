//! Quotation blocks for note markdown (wf-core `papers::quote_block`).
//!
//! The TS wrapper in `packages/wf-wasm/src/papers-quote-block.ts` is what callers import.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::quote_block::{format_quote_block, format_quote_cite_clipboard};

use super::check_text;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`format_quote_block`] for JS (TS `formatQuoteBlock`).
///
/// # Errors
///
/// Fails when `quote` is over the text cap.
#[wasm_bindgen(js_name = formatQuoteBlock)]
pub fn format_quote_block_js(quote: &str) -> JsResult<String> {
    check_text(quote)?;
    Ok(format_quote_block(quote))
}

/// [`format_quote_cite_clipboard`] for JS (TS `formatQuoteCiteClipboard`).
///
/// # Errors
///
/// Fails when `quote` is over the text cap.
#[wasm_bindgen(js_name = formatQuoteCiteClipboard)]
pub fn format_quote_cite_clipboard_js(quote: &str, paper_title: &str) -> JsResult<String> {
    check_text(quote)?;
    Ok(format_quote_cite_clipboard(quote, paper_title))
}
