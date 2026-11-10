//! TeX build-directory path check for JavaScript (wf-core `tex_path`). JS name matches
//! `packages/wf-wasm/src/tex-path.ts`.

use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::tex_path::safe_relative;

/// [`safe_relative`]: the normalised path inside the build directory.
///
/// # Errors
///
/// Throws an `Error` with the refusal message when the path leaves the build directory or names a
/// latexmk rc file.
#[wasm_bindgen(js_name = safeRelative)]
pub fn safe_relative_js(candidate: &str) -> Result<String, JsError> {
    safe_relative(candidate).map_err(|message| JsError::new(&message))
}
