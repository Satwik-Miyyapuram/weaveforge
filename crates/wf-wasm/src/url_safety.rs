//! Outbound URL and address checks for JavaScript (wf-core `url_safety`). The JS names match
//! `packages/core/src/net/url-safety.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::net::url_safety;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`check_url_shape`](url_safety::check_url_shape) on the parts of a parsed URL.
///
/// # Errors
///
/// Fails if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = checkUrlShape)]
pub fn check_url_shape_js(
    protocol: &str,
    has_credentials: bool,
    port: &str,
    hostname: &str,
) -> JsResult<JsValue> {
    to_js(&url_safety::check_url_shape(
        protocol,
        has_credentials,
        port,
        hostname,
    ))
}

/// [`is_ip_address`](url_safety::is_ip_address).
#[wasm_bindgen(js_name = isIpAddress)]
#[must_use]
pub fn is_ip_address_js(value: &str) -> bool {
    url_safety::is_ip_address(value)
}

/// [`is_public_address`](url_safety::is_public_address).
#[wasm_bindgen(js_name = isPublicAddress)]
#[must_use]
pub fn is_public_address_js(address: &str) -> bool {
    url_safety::is_public_address(address)
}

/// [`expand_ipv6`](url_safety::expand_ipv6); `undefined` when the text is not IPv6.
///
/// # Errors
///
/// Fails if the groups cannot be converted to a JS value.
#[wasm_bindgen(js_name = expandIpv6)]
pub fn expand_ipv6_js(value: &str) -> JsResult<JsValue> {
    to_js(&url_safety::expand_ipv6(value))
}
