//! Paper preview frame: the reader link and the saved page's site (wf-core
//! `papers::paper_preview`).
//!
//! The TS wrapper in `packages/wf-wasm/src/papers-preview.ts` gives the results their types.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::papers::paper_preview::{self, PaperPreview};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`preview_reader_href`](paper_preview::preview_reader_href) (TS `previewReaderHref`).
///
/// # Errors
///
/// Fails if `preview` is not a preview object, or the result cannot be converted.
#[wasm_bindgen(js_name = previewReaderHref, unchecked_return_type = "string | null")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn preview_reader_href_js(
    remote_href: Option<String>,
    #[wasm_bindgen(unchecked_param_type = "B.PaperPreview")] preview: JsValue,
    local_href: &str,
) -> JsResult<JsValue> {
    let preview: PaperPreview = serde_wasm_bindgen::from_value(preview)?;
    to_js(&paper_preview::preview_reader_href(
        remote_href.as_deref(),
        &preview,
        local_href,
    ))
}

/// [`site_of`](paper_preview::site_of) (TS `siteOf`).
#[wasm_bindgen(js_name = siteOf)]
pub fn site_of_js(url: &str) -> String {
    paper_preview::site_of(url)
}
