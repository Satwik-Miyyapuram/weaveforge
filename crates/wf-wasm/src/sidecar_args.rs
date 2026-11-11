//! Sidecar command-line parsing for JavaScript (wf-core `sidecar_args`). The JS name matches
//! `packages/wf-wasm/src/sidecar-args.ts`. Reading `process.argv`, resolving paths and printing the
//! error stay in `apps/shell/sidecar/src/main.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::sidecar_args::parse_sidecar_args;

use super::to_js;

/// [`parse_sidecar_args`](wf_core::sidecar_args::parse_sidecar_args): `{ kind: "ok", ... }` or `{ kind: "error", message }`
/// for an array of argv strings (without the program name).
///
/// # Errors
///
/// Fails when `argv` is not an array of strings, or when the result cannot be converted to a JS value.
#[wasm_bindgen(
    js_name = parseSidecarArgs,
    unchecked_return_type = "{ kind: \"ok\"; dataDir: string; migrations: string[]; backupsDir: string; migrateFrom: string | null; artifacts: string | null; bridge: string | null; appVersion: string | null; homeVariant: string | null; noLocalApi: boolean } | { kind: \"error\"; message: string }"
)]
pub fn parse_sidecar_args_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] argv: JsValue,
) -> Result<JsValue, JsError> {
    let argv: Vec<String> =
        serde_wasm_bindgen::from_value(argv).map_err(|error| JsError::new(&error.to_string()))?;
    to_js(&parse_sidecar_args(&argv)).map_err(|error| JsError::new(&error.to_string()))
}
