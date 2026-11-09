//! wasm exports for `storage::config` and `storage::blob_client` (TS: `storage-config.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::storage::blob_client::{
    ColdFields, R2Fields, cold_blob_client_config, missing_r2_config_message, r2_blob_client_config,
};
use wf_core::storage::config::{
    BlobRuntime, EnvMap, blob_provider_for_runtime, parse_blob_provider, read_storage_config,
};

use super::to_js;

/// [`read_storage_config`]. `env` is a plain object of env name to string value.
///
/// # Errors
///
/// Fails if `env` is not an object of strings, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = readStorageConfig)]
pub fn read_storage_config_js(env: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let env: EnvMap = serde_wasm_bindgen::from_value(env)?;
    to_js(&read_storage_config(&env))
}

/// [`blob_provider_for_runtime`]. `configured` is `tiered` or anything else for Supabase.
///
/// # Errors
///
/// Fails if `runtime` is not `{ inBrowser, publicProvider? }`, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = blobProviderForRuntime)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn blob_provider_for_runtime_js(
    configured: String,
    runtime: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let runtime: BlobRuntime = serde_wasm_bindgen::from_value(runtime)?;
    let configured = parse_blob_provider(Some(configured.as_str()));
    to_js(&blob_provider_for_runtime(configured, &runtime))
}

/// [`r2_blob_client_config`]. `null` when any R2 field is unset or empty.
///
/// # Errors
///
/// Fails if `fields` is not an object of optional strings, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = r2BlobClientConfig)]
pub fn r2_blob_client_config_js(fields: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let fields: R2Fields = serde_wasm_bindgen::from_value(fields)?;
    to_js(&r2_blob_client_config(&fields))
}

/// [`cold_blob_client_config`]. `null` when any cold-tier field is unset or empty.
///
/// # Errors
///
/// Fails if `fields` is not an object of optional strings, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = coldBlobClientConfig)]
pub fn cold_blob_client_config_js(fields: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let fields: ColdFields = serde_wasm_bindgen::from_value(fields)?;
    to_js(&cold_blob_client_config(&fields))
}

/// [`missing_r2_config_message`]: names the unset R2 env vars, never values.
///
/// # Errors
///
/// Fails if `fields` is not an object of optional strings, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = missingR2ConfigMessage)]
pub fn missing_r2_config_message_js(fields: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let fields: R2Fields = serde_wasm_bindgen::from_value(fields)?;
    to_js(&missing_r2_config_message(&fields))
}
