//! Experiment artifact names and view URLs for JavaScript (wf-core `experiment_artifacts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::experiment_artifacts;

/// [`safe_name`](experiment_artifacts::safe_name).
#[wasm_bindgen(js_name = safeName)]
#[must_use]
pub fn safe_name_js(name: &str) -> String {
    experiment_artifacts::safe_name(name)
}

/// [`viewable_artifact_url`](experiment_artifacts::viewable_artifact_url); `null` when refused.
#[wasm_bindgen(js_name = viewableArtifactUrl, unchecked_return_type = "string | null")]
#[must_use]
pub fn viewable_artifact_url_js(entry: &str, in_shell: bool) -> JsValue {
    let value = experiment_artifacts::viewable_artifact_url(entry, in_shell);
    value.map_or(JsValue::NULL, JsValue::from)
}

/// [`is_absolute_url`](experiment_artifacts::is_absolute_url).
#[wasm_bindgen(js_name = isAbsoluteUrl)]
#[must_use]
pub fn is_absolute_url_js(value: &str) -> bool {
    experiment_artifacts::is_absolute_url(value)
}

/// [`is_absolute_entry`](experiment_artifacts::is_absolute_entry).
#[wasm_bindgen(js_name = isAbsoluteEntry)]
#[must_use]
pub fn is_absolute_entry_js(entry: &str) -> bool {
    experiment_artifacts::is_absolute_entry(entry)
}

/// [`artifact_kind`](experiment_artifacts::artifact_kind): `image`, `pdf` or `link`.
#[wasm_bindgen(js_name = artifactKind)]
#[must_use]
pub fn artifact_kind_js(entry: &str) -> String {
    experiment_artifacts::artifact_kind(entry)
        .as_str()
        .to_owned()
}
