//! Local experiment push SQL and decisions for JavaScript (wf-core
//! `sync::local_experiment_push`). The JS names are called from
//! `apps/web/src/backend/providers/local/parts-1.ts`.

use wasm_bindgen::JsError;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::local_experiment_push::{
    ARTIFACT_BUCKET, BATCH, account_artifacts_pattern, artifact_rest, artifact_storage_name,
    artifact_storage_path, prefer_webp, push_sql, pushed_cursor, should_recompress,
};

/// [`push_sql`] for JS: the statement with this name. Fails for an unknown name.
///
/// # Errors
///
/// Fails when `name` is not a statement of the experiment push.
#[wasm_bindgen(js_name = localExperimentPushSql)]
pub fn local_experiment_push_sql_js(name: &str) -> Result<String, JsError> {
    push_sql(name).ok_or_else(|| JsError::new(&format!("unknown experiment push statement: {name}")))
}

/// [`pushed_cursor`] for JS: the step to read from (`pushed ?? -2147483648`).
#[wasm_bindgen(js_name = localExperimentPushedCursor)]
#[must_use]
pub fn local_experiment_pushed_cursor_js(pushed: Option<f64>) -> f64 {
    pushed_cursor(pushed)
}

/// [`artifact_rest`] for JS: the part after `app://artifacts/`, or `undefined` when the
/// entry is not a desktop-local artifact link.
#[wasm_bindgen(js_name = localExperimentArtifactRest)]
#[must_use]
pub fn local_experiment_artifact_rest_js(entry: &str) -> Option<String> {
    artifact_rest(entry).map(str::to_owned)
}

/// [`artifact_storage_name`] for JS: the file name in storage.
#[wasm_bindgen(js_name = localExperimentArtifactStorageName)]
#[must_use]
pub fn local_experiment_artifact_storage_name_js(rest: &str, recompressed: bool) -> String {
    artifact_storage_name(rest, recompressed)
}

/// [`artifact_storage_path`] for JS: `{accountId}/{name}`.
#[wasm_bindgen(js_name = localExperimentArtifactStoragePath)]
#[must_use]
pub fn local_experiment_artifact_storage_path_js(account_id: &str, name: &str) -> String {
    artifact_storage_path(account_id, name)
}

/// [`should_recompress`] for JS: whether a blob of this media type goes to webp first.
#[wasm_bindgen(js_name = localExperimentShouldRecompress)]
#[must_use]
pub fn local_experiment_should_recompress_js(mime: &str) -> bool {
    should_recompress(mime)
}

/// [`prefer_webp`] for JS: whether the webp copy is kept (webp and smaller).
#[wasm_bindgen(js_name = localExperimentPreferWebp)]
#[must_use]
pub fn local_experiment_prefer_webp_js(webp_mime: &str, webp_size: f64, original_size: f64) -> bool {
    prefer_webp(webp_mime, webp_size, original_size)
}

/// [`BATCH`] for JS: the metric points one push batch sends. The loop ends on a short batch.
#[wasm_bindgen(js_name = localExperimentBatch)]
#[must_use]
pub fn local_experiment_batch_js() -> u32 {
    BATCH
}

/// [`ARTIFACT_BUCKET`] for JS: the storage bucket the pushed artifacts go to.
#[wasm_bindgen(js_name = localExperimentArtifactBucket)]
#[must_use]
pub fn local_experiment_artifact_bucket_js() -> String {
    ARTIFACT_BUCKET.to_owned()
}

/// [`account_artifacts_pattern`] for JS: the LIKE pattern for rows already holding this account's paths.
#[wasm_bindgen(js_name = localExperimentAccountArtifactsPattern)]
#[must_use]
pub fn local_experiment_account_artifacts_pattern_js(account_id: &str) -> String {
    account_artifacts_pattern(account_id)
}
