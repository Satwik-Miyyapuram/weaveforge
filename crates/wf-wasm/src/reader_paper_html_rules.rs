//! Paper HTML relay rules for JavaScript (`apps/web/src/features/reader/application/paper-html-rules.ts`).
//! Wraps `wf_core::reader::paper_html_rules` and holds the relay constants that the web callers
//! use. Byte decoding stays in TS (`TextDecoder`), which takes the charset from here.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::paper_html_rules::{declared_charset, is_html_content_type};

/// The relay route the web app fetches a paper page through.
pub const HTML_PROXY_PATH: &str = "/api/html-proxy";

/// A full-text page with inline figures is a few MiB at most; this is headroom.
pub const HTML_PROXY_MAX_BYTES: u32 = 15 * 1024 * 1024;

/// The header the relay puts the address it ended up at in, after redirects.
pub const HTML_FINAL_URL_HEADER: &str = "x-final-url";

/// [`HTML_PROXY_PATH`]: the relay route.
#[wasm_bindgen(js_name = htmlProxyPath)]
#[must_use]
pub fn html_proxy_path_js() -> String {
    HTML_PROXY_PATH.to_owned()
}

/// [`HTML_PROXY_MAX_BYTES`]: the largest page the relay accepts, in bytes.
#[wasm_bindgen(js_name = htmlProxyMaxBytes)]
#[must_use]
pub fn html_proxy_max_bytes_js() -> u32 {
    HTML_PROXY_MAX_BYTES
}

/// [`HTML_FINAL_URL_HEADER`]: the response header naming the post-redirect address.
#[wasm_bindgen(js_name = htmlFinalUrlHeader)]
#[must_use]
pub fn html_final_url_header_js() -> String {
    HTML_FINAL_URL_HEADER.to_owned()
}

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

#[cfg(test)]
mod tests {
    use super::{
        HTML_FINAL_URL_HEADER, HTML_PROXY_MAX_BYTES, HTML_PROXY_PATH, html_final_url_header_js,
        html_proxy_max_bytes_js, html_proxy_path_js,
    };

    #[test]
    fn relay_constants_match_the_web_callers() {
        assert_eq!(html_proxy_path_js(), "/api/html-proxy");
        assert_eq!(html_proxy_path_js(), HTML_PROXY_PATH);
        assert_eq!(html_final_url_header_js(), "x-final-url");
        assert_eq!(html_final_url_header_js(), HTML_FINAL_URL_HEADER);
        assert_eq!(html_proxy_max_bytes_js(), 15 * 1024 * 1024);
        assert_eq!(html_proxy_max_bytes_js(), HTML_PROXY_MAX_BYTES);
    }
}
