//! Reader URL allowlists (`apps/web/src/features/reader/application/sanitize-reader-url.ts`).
//! Wraps `wf_core::reader::sanitize_reader_url`. The DOM reads (`location`, the relay base) stay
//! in TS and are passed in.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::sanitize_reader_url::{
    PaperPdfSource, is_allowed_pdf_proxy_url, is_reader_object_url, looks_like_pdf_url,
    original_url_from_proxy, pdf_proxy_path, resolve_paper_pdf_url, sanitize_app_href,
    sanitize_pdf_url, sanitize_reader_href,
};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`is_allowed_pdf_proxy_url`]: https, no credentials, and an allowlisted host.
#[wasm_bindgen(js_name = isAllowedPdfProxyUrl)]
pub fn is_allowed_pdf_proxy_url_js(raw: &str) -> bool {
    is_allowed_pdf_proxy_url(raw)
}

/// [`pdf_proxy_path`]: the same-origin proxy route for an allowlisted PDF URL, or `null` when the
/// URL is not one the proxy fetches.
#[wasm_bindgen(js_name = pdfProxyPath, unchecked_return_type = "string | null")]
pub fn pdf_proxy_path_js(url: &str) -> JsValue {
    pdf_proxy_path(url).map_or(JsValue::NULL, JsValue::from)
}

/// [`original_url_from_proxy`]: the PDF URL a same-origin proxy request carries, or `null`.
/// `path` is the relay path of `url`.
#[wasm_bindgen(js_name = originalUrlFromProxy, unchecked_return_type = "string | null")]
pub fn original_url_from_proxy_js(path: &str, url: &str) -> JsValue {
    original_url_from_proxy(path, url).map_or(JsValue::NULL, JsValue::from)
}

/// [`is_reader_object_url`]: whether `raw` is a `blob:` URL minted by `origin`.
#[wasm_bindgen(js_name = isReaderObjectUrl)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn is_reader_object_url_js(
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] raw: Option<
        String,
    >,
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] origin: Option<
        String,
    >,
) -> bool {
    is_reader_object_url(raw.as_deref(), origin.as_deref())
}

/// [`sanitize_pdf_url`]: `null` when the URL is refused.
#[wasm_bindgen(js_name = sanitizePdfUrl, unchecked_return_type = "string | null")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn sanitize_pdf_url_js(
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] raw: Option<
        String,
    >,
) -> JsValue {
    sanitize_pdf_url(raw.as_deref()).map_or(JsValue::NULL, JsValue::from)
}

/// [`sanitize_reader_href`]: a same-origin `/reader` path, or `None`.
#[wasm_bindgen(js_name = sanitizeReaderHref, unchecked_return_type = "string | null")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn sanitize_reader_href_js(
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] raw: Option<
        String,
    >,
) -> JsValue {
    sanitize_reader_href(raw.as_deref()).map_or(JsValue::NULL, JsValue::from)
}

/// [`sanitize_app_href`]: a same-origin app path on a known root, or `None`.
#[wasm_bindgen(js_name = sanitizeAppHref, unchecked_return_type = "string | null")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn sanitize_app_href_js(
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] raw: Option<
        String,
    >,
) -> JsValue {
    sanitize_app_href(raw.as_deref()).map_or(JsValue::NULL, JsValue::from)
}

/// [`looks_like_pdf_url`]: `true` for a direct PDF path, `false` for an HTML landing page.
#[wasm_bindgen(js_name = looksLikePdfUrl)]
pub fn looks_like_pdf_url_js(url: &str) -> bool {
    looks_like_pdf_url(url)
}

/// [`resolve_paper_pdf_url`]: `source` is `{ url, arxivId, openAccessPdf }`, each optional.
/// Unknown fields such as `pdfPath` are ignored, as the TS version ignores them. Returns `null`
/// when no URL can be derived.
///
/// # Errors
///
/// Fails if `source` is not an object of strings or `null`.
#[wasm_bindgen(js_name = resolvePaperPdfUrl, unchecked_return_type = "string | null")]
pub fn resolve_paper_pdf_url_js(
    #[wasm_bindgen(
        unchecked_param_type = "{ url?: string | null; arxivId?: string | null; openAccessPdf?: string | null }"
    )]
    source: JsValue,
) -> JsResult<JsValue> {
    let source: PaperPdfSource = serde_wasm_bindgen::from_value(source)?;
    Ok(resolve_paper_pdf_url(&source).map_or(JsValue::NULL, |url| JsValue::from_str(&url)))
}

#[cfg(test)]
mod tests {
    use super::{is_reader_object_url, original_url_from_proxy, pdf_proxy_path};

    #[test]
    fn proxied_pdf_url_rewrites_allowlisted_hosts_through_the_same_origin_proxy() {
        assert_eq!(
            pdf_proxy_path("https://arxiv.org/pdf/1706.03762").as_deref(),
            Some("/api/pdf-proxy?url=https%3A%2F%2Farxiv.org%2Fpdf%2F1706.03762")
        );
        assert_eq!(pdf_proxy_path("https://evil.test/a.pdf"), None);
    }

    #[test]
    fn is_reader_object_url_accepts_this_origins_object_urls_and_nothing_else() {
        let origin = Some("https://weaveforge.test");
        // The reader caches PDF bytes and re-opens them through createObjectURL, so the second
        // visit to any paper is a blob: URL. Rejecting it made the reader refuse its own cache.
        assert!(is_reader_object_url(
            Some("blob:https://weaveforge.test/2f1c-4b"),
            origin
        ));
        // Another origin's handle is not ours to read.
        assert!(!is_reader_object_url(
            Some("blob:https://evil.example/2f1c-4b"),
            origin
        ));
        assert!(!is_reader_object_url(Some("blob:not-a-url"), origin));
        assert!(!is_reader_object_url(
            Some("https://arxiv.org/pdf/1706.03762"),
            origin
        ));
        assert!(!is_reader_object_url(Some("javascript:alert(1)"), origin));
        assert!(!is_reader_object_url(None, origin));
        assert!(!is_reader_object_url(
            Some("blob:https://weaveforge.test/2f1c-4b"),
            None
        ));
    }

    #[test]
    fn original_url_from_proxy_recovers_the_pdf_url_only_from_a_pdf_proxy_path() {
        let proxied = pdf_proxy_path("https://arxiv.org/pdf/1706.03762").unwrap_or_default();
        assert_eq!(
            original_url_from_proxy(&proxied, &proxied).as_deref(),
            Some("https://arxiv.org/pdf/1706.03762")
        );
        assert_eq!(
            original_url_from_proxy("/papers", "/papers?url=https://arxiv.org/pdf/1"),
            None
        );
    }
}
