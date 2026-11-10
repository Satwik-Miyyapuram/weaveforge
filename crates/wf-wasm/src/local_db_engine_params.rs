//! wasm exports for the local engine start parameters (wf-core `local_db_engine_params`; TS: `local-db-engine-params.ts`).

use wasm_bindgen::{JsValue, prelude::wasm_bindgen};
use wf_core::local_db_engine_params;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`local_db_engine_params::LOCAL_DB_SHARED_BUFFERS`]: the `shared_buffers` value the local engine runs with.
#[wasm_bindgen(js_name = localDbSharedBuffers)]
pub fn local_db_shared_buffers() -> String {
    local_db_engine_params::LOCAL_DB_SHARED_BUFFERS.to_owned()
}

/// [`local_db_engine_params::engine_start_params`]: `defaults` (a string array) with the shared-buffers flags appended.
#[wasm_bindgen(js_name = engineStartParams, unchecked_return_type = "string[]")]
pub fn engine_start_params_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] defaults: JsValue,
) -> JsResult<JsValue> {
    let defaults: Vec<String> = serde_wasm_bindgen::from_value(defaults)?;
    serde_wasm_bindgen::to_value(&local_db_engine_params::engine_start_params(&defaults))
}
