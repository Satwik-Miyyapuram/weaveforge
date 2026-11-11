//! Origin comparison for the IPC guard (wf-core `ipc_origin`). The JS names match
//! `apps/shell/sidecar/src/ipc-guard.ts`. Electron event wiring stays in TypeScript.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ipc_origin;

/// [`same_origin`](ipc_origin::same_origin): whether `url` is the same origin as `origin`.
#[wasm_bindgen(js_name = sameOrigin)]
pub fn same_origin_js(url: &str, origin: &str) -> bool {
    ipc_origin::same_origin(url, origin)
}

/// [`origin_of`](ipc_origin::origin_of): the origin of `url`, or `null` when it does not parse.
#[wasm_bindgen(js_name = originOf, unchecked_return_type = "string | null")]
pub fn origin_of_js(url: &str) -> JsValue {
    ipc_origin::origin_of(url).map_or(JsValue::NULL, JsValue::from)
}
