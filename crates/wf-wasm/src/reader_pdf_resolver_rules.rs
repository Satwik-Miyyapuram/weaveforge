//! Open-access and WebDAV PDF ladder trim rules for JavaScript (wf-core
//! `reader::pdf_resolver_rules`). The JS names match `OpenAccessPdfResolver` and
//! `WebDavPdfResolver` in `packages/core/src/reader/`.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::reader::pdf_resolver_rules::{open_access_supports, trimmed_or_none, webdav_supports};

/// [`open_access_supports`] (TS `OpenAccessPdfResolver.supports`).
#[wasm_bindgen(js_name = openAccessSupports)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn open_access_supports_js(
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] arxiv_id: Option<
        String,
    >,
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] url: Option<
        String,
    >,
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] doi: Option<
        String,
    >,
) -> bool {
    open_access_supports(arxiv_id.as_deref(), url.as_deref(), doi.as_deref())
}

/// [`webdav_supports`] (TS `WebDavPdfResolver.supports`).
#[wasm_bindgen(js_name = webdavSupports)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn webdav_supports_js(webdav_path: Option<String>) -> bool {
    webdav_supports(webdav_path.as_deref())
}

/// [`trimmed_or_none`]: trim a resolver path or URL, null when blank.
#[wasm_bindgen(js_name = trimmedOrNone, unchecked_return_type = "string | null")]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn trimmed_or_none_js(
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] value: Option<
        String,
    >,
) -> JsValue {
    trimmed_or_none(value.as_deref()).map_or(JsValue::NULL, JsValue::from)
}
