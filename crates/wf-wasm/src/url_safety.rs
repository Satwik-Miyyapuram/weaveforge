//! Outbound URL and address checks for JavaScript (wf-core `url_safety`). The JS names match
//! `UrlSafetyFns` in `packages/core/src/shared/core-contract.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::net::url_safety::{self, UrlCheck, UrlRejection};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

#[wasm_bindgen]
extern "C" {
    /// The WHATWG `URL` class.
    #[wasm_bindgen(js_name = URL, typescript_type = "URL")]
    type Url;

    /// `new URL(input)`; throws when `input` is not an absolute URL.
    #[wasm_bindgen(catch, constructor, js_class = URL)]
    fn new(input: &str) -> Result<Url, JsValue>;

    #[wasm_bindgen(method, getter, js_class = URL)]
    fn protocol(this: &Url) -> String;

    #[wasm_bindgen(method, getter, js_class = URL)]
    fn username(this: &Url) -> String;

    #[wasm_bindgen(method, getter, js_class = URL)]
    fn password(this: &Url) -> String;

    #[wasm_bindgen(method, getter, js_class = URL)]
    fn port(this: &Url) -> String;

    #[wasm_bindgen(method, getter, js_class = URL)]
    fn hostname(this: &Url) -> String;
}

/// Whether `text` starts with a URL scheme, as `/^[a-z][a-z0-9+.-]*:/i` tests it.
fn has_scheme(text: &str) -> bool {
    let mut chars = text.chars();
    if !chars.next().is_some_and(|c| c.is_ascii_alphabetic()) {
        return false;
    }
    for c in chars {
        if c == ':' {
            return true;
        }
        if !(c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-')) {
            return false;
        }
    }
    false
}

/// `input` trimmed (JS whitespace) and parsed, with `https://` put in front of a scheme-less
/// host; `None` when empty or unparseable.
fn parse_user_url(input: &str) -> Option<Url> {
    let trimmed = String::from(js_sys::JsString::from(input).trim());
    if trimmed.is_empty() {
        return None;
    }
    let text = if has_scheme(&trimmed) {
        trimmed
    } else {
        format!("https://{trimmed}")
    };
    Url::new(&text).ok()
}

/// Parses a URL, accepting a scheme-less host the way a person would type it; `null` when the
/// trimmed input is empty or does not parse.
#[wasm_bindgen(js_name = parseUserUrl, unchecked_return_type = "URL | null")]
#[must_use]
pub fn parse_user_url_js(input: &str) -> JsValue {
    parse_user_url(input).map_or(JsValue::NULL, JsValue::from)
}

/// [`check_url_shape`](url_safety::check_url_shape): decides from the URL alone whether it may
/// be fetched. A string is parsed as [`parseUserUrl`](parse_user_url_js) does; one that does not
/// parse is refused as `"not-a-url"`.
///
/// # Errors
///
/// Fails if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = checkUrlShape, unchecked_return_type = "B.UrlCheck")]
pub fn check_url_shape_js(
    #[wasm_bindgen(unchecked_param_type = "string | URL")] input: JsValue,
) -> JsResult<JsValue> {
    let url = match input.as_string() {
        Some(text) => parse_user_url(&text),
        None => Some(input.unchecked_into::<Url>()),
    };
    let Some(url) = url else {
        return to_js(&UrlCheck {
            ok: false,
            reason: Some(UrlRejection::NotAUrl),
        });
    };
    let has_credentials = !url.username().is_empty() || !url.password().is_empty();
    to_js(&url_safety::check_url_shape(
        &url.protocol(),
        has_credentials,
        &url.port(),
        &url.hostname(),
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

/// [`expand_ipv6`](url_safety::expand_ipv6): the eight groups; `null` when the text is not IPv6.
///
/// # Errors
///
/// Fails if the groups cannot be converted to a JS value.
#[wasm_bindgen(js_name = expandIpv6, unchecked_return_type = "number[] | null")]
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
