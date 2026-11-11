//! Reader URL allowlists (`apps/web/src/features/reader/application/sanitize-reader-url.ts`).
//! Wraps `wf_core::reader::sanitize_reader_url`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::sanitize_reader_url::{
    PaperPdfSource, is_allowed_pdf_proxy_url, looks_like_pdf_url, resolve_paper_pdf_url,
    sanitize_app_href, sanitize_pdf_url, sanitize_reader_href,
};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`is_allowed_pdf_proxy_url`]: https, no credentials, and an allowlisted host.
#[wasm_bindgen(js_name = isAllowedPdfProxyUrl)]
pub fn is_allowed_pdf_proxy_url_js(raw: &str) -> bool {
    is_allowed_pdf_proxy_url(raw)
}

/// [`sanitize_pdf_url`]: `null` when the URL is refused.
#[wasm_bindgen(js_name = sanitizePdfUrl, unchecked_return_type = "string | null")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn sanitize_pdf_url_js(
    #[wasm_bindgen(unchecked_param_type = "string | null | undefined")] raw: Option<String>,
) -> JsValue {
    sanitize_pdf_url(raw.as_deref()).map_or(JsValue::NULL, JsValue::from)
}

/// [`sanitize_reader_href`]: a same-origin `/reader` path, or `None`.
#[wasm_bindgen(js_name = sanitizeReaderHref, unchecked_return_type = "string | null")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn sanitize_reader_href_js(
    #[wasm_bindgen(unchecked_param_type = "string | null | undefined")] raw: Option<String>,
) -> JsValue {
    sanitize_reader_href(raw.as_deref()).map_or(JsValue::NULL, JsValue::from)
}

/// [`sanitize_app_href`]: a same-origin app path on a known root, or `None`.
#[wasm_bindgen(js_name = sanitizeAppHref, unchecked_return_type = "string | null")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn sanitize_app_href_js(
    #[wasm_bindgen(unchecked_param_type = "string | null | undefined")] raw: Option<String>,
) -> JsValue {
    sanitize_app_href(raw.as_deref()).map_or(JsValue::NULL, JsValue::from)
}

/// [`looks_like_pdf_url`]: `true` for a direct PDF path, `false` for an HTML landing page.
#[wasm_bindgen(js_name = looksLikePdfUrl)]
pub fn looks_like_pdf_url_js(url: &str) -> bool {
    looks_like_pdf_url(url)
}

/// [`resolve_paper_pdf_url`]: `source` is `{ url, arxivId, openAccessPdf }`, each optional.
/// Unknown fields such as `pdfPath` are ignored, as the TS version ignores them.
///
/// # Errors
///
/// Fails if `source` is not an object of strings or `null`.
#[wasm_bindgen(js_name = resolvePaperPdfUrl)]
pub fn resolve_paper_pdf_url_js(source: JsValue) -> JsResult<Option<String>> {
    let source: PaperPdfSource = serde_wasm_bindgen::from_value(source)?;
    Ok(resolve_paper_pdf_url(&source))
}
