//! Desktop update check for JavaScript (wf-core `update_check`). JS names match
//! `packages/wf-wasm/src/update-check.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::update_check::{Release, Version, is_newer, newest_release, parse_tag, parse_version};

use super::to_js;

/// [`parse_tag`]: `v0.5.2` to `[0, 5, 2]`, or `null` for any other tag.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = parseReleaseTag)]
pub fn parse_release_tag_js(tag: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&parse_tag(tag))
}

/// [`parse_version`]: `0.5.2` to `[0, 5, 2]`, or `null`.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = parseAppVersion)]
pub fn parse_app_version_js(version: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&parse_version(version))
}

/// [`is_newer`]: whether `candidate` is later than `current`, both `[major, minor, patch]`.
///
/// # Errors
///
/// Fails if either argument is not three numbers.
#[wasm_bindgen(js_name = isNewerVersion)]
pub fn is_newer_version_js(
    candidate: JsValue,
    current: JsValue,
) -> Result<bool, serde_wasm_bindgen::Error> {
    let candidate: Version = serde_wasm_bindgen::from_value(candidate)?;
    let current: Version = serde_wasm_bindgen::from_value(current)?;
    Ok(is_newer(candidate, current))
}

/// [`newest_release`]: the newest stable desktop release in `releases`, or `null`.
///
/// # Errors
///
/// Fails if `releases` does not match the release list shape, or the result cannot be converted
/// to JS.
#[wasm_bindgen(js_name = newestDesktopRelease, unchecked_return_type = "B.NewestRelease | null")]
pub fn newest_desktop_release_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.ReleaseRow[]")] releases: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let releases: Vec<Release> = serde_wasm_bindgen::from_value(releases)?;
    to_js(&newest_release(&releases))
}
