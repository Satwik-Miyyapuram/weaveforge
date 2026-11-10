//! Outbound URL and address checks for JavaScript (wf-core `url_safety`). The JS names match
//! `UrlSafetyFns` in `packages/core/src/shared/core-contract.ts`.

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

/// [`looks_like_image_url`](wf_core::net::image_url::looks_like_image_url): the URL's own
/// path names a picture, so a pasted link is worth downloading.
#[wasm_bindgen(js_name = looksLikeImageUrl)]
#[must_use]
pub fn looks_like_image_url_js(url: &str) -> bool {
    wf_core::net::image_url::looks_like_image_url(url)
}

/// [`rejection_copy`](url_safety::rejection_copy) for a reason code such as `"scheme"`.
///
/// # Errors
///
/// Fails if the value is not a known reason code.
#[wasm_bindgen(js_name = describeUrlRejection)]
pub fn describe_url_rejection_js(
    #[wasm_bindgen(unchecked_param_type = "B.UrlRejection")] reason: JsValue,
) -> JsResult<String> {
    let reason: url_safety::UrlRejection = serde_wasm_bindgen::from_value(reason)?;
    Ok(url_safety::rejection_copy(reason).to_owned())
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

/// [`DEFAULT_FETCH_LIMITS`](url_safety::DEFAULT_FETCH_LIMITS): the caps read at call time.
///
/// # Errors
///
/// Fails if the limits cannot be converted to a JS value.
#[wasm_bindgen(js_name = fetchLimits, unchecked_return_type = "B.OutboundFetchLimits")]
pub fn fetch_limits_js() -> JsResult<JsValue> {
    to_js(&url_safety::DEFAULT_FETCH_LIMITS)
}
