//! Experiment artifact names and view URLs for JavaScript (wf-core `experiment_artifacts`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::experiment_artifacts;

/// [`safe_name`](experiment_artifacts::safe_name).
#[wasm_bindgen(js_name = safeName)]
#[must_use]
pub fn safe_name_js(name: &str) -> String {
    experiment_artifacts::safe_name(name)
}

/// [`viewable_artifact_url`](experiment_artifacts::viewable_artifact_url); `undefined` when refused.
#[wasm_bindgen(js_name = viewableArtifactUrl)]
#[must_use]
pub fn viewable_artifact_url_js(entry: &str, in_shell: bool) -> Option<String> {
    experiment_artifacts::viewable_artifact_url(entry, in_shell)
}
