//! Git text output parsers for JavaScript (wf-core `sync::vault_git_parse`). The JS names match
//! `packages/wf-wasm/src/vault-git-parse.ts`; running git and reading its stdout stay in
//! `apps/shell/sidecar/src/vault-git.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::sync::vault_git_parse::{
    PATH_CHUNK_MAX_UNITS, nul_list, overwritten_files, parse_log, parse_status, path_chunks,
};

use super::to_js;

/// [`parse_status`](wf_core::sync::vault_git_parse::parse_status): `[{ path, state }]` from porcelain `-z` output.
///
/// # Errors
///
/// Fails when the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = gitParseStatus, unchecked_return_type = "{ path: string; state: \"deleted\" | \"added\" | \"modified\" }[]")]
pub fn git_parse_status_js(stdout: &str) -> Result<JsValue, JsError> {
    to_js(&parse_status(stdout)).map_err(|error| JsError::new(&error.to_string()))
}

/// [`parse_log`](wf_core::sync::vault_git_parse::parse_log): `[{ oid, authoredAt, author, message }]`.
///
/// # Errors
///
/// Fails when the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = gitParseLog, unchecked_return_type = "{ oid: string; authoredAt: string; author: string; message: string }[]")]
pub fn git_parse_log_js(stdout: &str) -> Result<JsValue, JsError> {
    to_js(&parse_log(stdout)).map_err(|error| JsError::new(&error.to_string()))
}

/// [`overwritten_files`](wf_core::sync::vault_git_parse::overwritten_files): the paths in a "would be overwritten" listing.
///
/// # Errors
///
/// Fails when the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = gitOverwrittenFiles, unchecked_return_type = "string[]")]
pub fn git_overwritten_files_js(output: &str) -> Result<JsValue, JsError> {
    to_js(&overwritten_files(output)).map_err(|error| JsError::new(&error.to_string()))
}

/// [`nul_list`](wf_core::sync::vault_git_parse::nul_list): the non-empty entries of a NUL-separated listing.
///
/// # Errors
///
/// Fails when the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = gitNulList, unchecked_return_type = "string[]")]
pub fn git_nul_list_js(stdout: &str) -> Result<JsValue, JsError> {
    to_js(&nul_list(stdout)).map_err(|error| JsError::new(&error.to_string()))
}

/// [`path_chunks`](wf_core::sync::vault_git_parse::path_chunks): batches of paths for one command line each.
/// `max_units` defaults to [`PATH_CHUNK_MAX_UNITS`](wf_core::sync::vault_git_parse::PATH_CHUNK_MAX_UNITS).
///
/// # Errors
///
/// Fails when `paths` is not an array of strings, or when the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = gitPathChunks)]
pub fn git_path_chunks_js(paths: JsValue, max_units: Option<u32>) -> Result<JsValue, JsError> {
    let paths: Vec<String> =
        serde_wasm_bindgen::from_value(paths).map_err(|error| JsError::new(&error.to_string()))?;
    let limit = max_units.map_or(PATH_CHUNK_MAX_UNITS, |units| units as usize);
    to_js(&path_chunks(&paths, limit)).map_err(|error| JsError::new(&error.to_string()))
}
