//! wasm exports for `storage::config` and `storage::blob_client` (TS: `storage-config.ts`).

use js_sys::{Array, Object};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::storage::blob_client::{
    ColdFields, R2Fields, cold_blob_client_config, missing_r2_config_message, object_key,
    r2_blob_client_config, read_content_type, upload_content_type,
};
use wf_core::storage::config::{
    BlobRuntime, EnvMap, blob_provider_for_runtime, parse_blob_provider, read_storage_config,
};

use super::to_js;

/// [`read_storage_config`]. `env` is a plain object of env name to string value; an
/// `undefined` value counts as unset.
///
/// # Errors
///
/// Fails if a set value in `env` is not a string, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = readStorageConfig, unchecked_return_type = "B.StorageConfig")]
pub fn read_storage_config_js(
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string | undefined>>")]
    env: &Object,
) -> Result<JsValue, JsValue> {
    let mut defined = EnvMap::new();
    for entry in Object::entries(env).iter() {
        let pair: Array = entry.unchecked_into();
        let value = pair.get(1);
        if value.is_undefined() {
            continue;
        }
        let name = pair.get(0).as_string().unwrap_or_default();
        let _ = defined.insert(name, serde_wasm_bindgen::from_value(value)?);
    }
    Ok(to_js(&read_storage_config(&defined))?)
}

/// [`blob_provider_for_runtime`]. `configured` is `tiered` or anything else for Supabase.
///
/// # Errors
///
/// Fails if `runtime` is not `{ inBrowser, publicProvider? }`, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = blobProviderForRuntime, unchecked_return_type = "B.BlobProviderId")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn blob_provider_for_runtime_js(
    configured: String,
    #[wasm_bindgen(unchecked_param_type = "B.BlobRuntime")] runtime: JsValue,
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
#[wasm_bindgen(js_name = r2BlobClientConfig, unchecked_return_type = "B.BlobClientConfig | null")]
pub fn r2_blob_client_config_js(
    #[wasm_bindgen(unchecked_param_type = "B.R2Fields")] fields: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let fields: R2Fields = serde_wasm_bindgen::from_value(fields)?;
    to_js(&r2_blob_client_config(&fields))
}

/// [`cold_blob_client_config`]. `null` when any cold-tier field is unset or empty.
///
/// # Errors
///
/// Fails if `fields` is not an object of optional strings, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = coldBlobClientConfig, unchecked_return_type = "B.BlobClientConfig | null")]
pub fn cold_blob_client_config_js(
    #[wasm_bindgen(unchecked_param_type = "B.ColdFields")] fields: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let fields: ColdFields = serde_wasm_bindgen::from_value(fields)?;
    to_js(&cold_blob_client_config(&fields))
}

/// [`missing_r2_config_message`]: names the unset R2 env vars, never values.
///
/// # Errors
///
/// Fails if `fields` is not an object of optional strings, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = missingR2ConfigMessage, unchecked_return_type = "string")]
pub fn missing_r2_config_message_js(
    #[wasm_bindgen(unchecked_param_type = "B.R2Fields")] fields: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let fields: R2Fields = serde_wasm_bindgen::from_value(fields)?;
    to_js(&missing_r2_config_message(&fields))
}

/// [`object_key`]: the logical bucket and path joined as the S3 object key.
#[wasm_bindgen(js_name = objectKey)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn object_key_js(logical_bucket: String, path: String) -> String {
    object_key(&logical_bucket, &path)
}

/// [`upload_content_type`]: the explicit type, else the blob type, else the fallback.
#[wasm_bindgen(js_name = uploadContentType)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn upload_content_type_js(explicit: Option<String>, blob_type: String) -> String {
    upload_content_type(explicit.as_deref(), &blob_type)
}

/// [`read_content_type`]: the stored type, or the fallback when none is stored.
#[wasm_bindgen(js_name = readContentType)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn read_content_type_js(stored: Option<String>) -> String {
    read_content_type(stored.as_deref())
}
