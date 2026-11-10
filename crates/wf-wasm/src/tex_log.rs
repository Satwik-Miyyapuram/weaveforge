//! TeX argument vectors and log parsing for JavaScript (wf-core `tex_log`). JS names match
//! `packages/wf-wasm/src/tex-log.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::tex_log::{TexEngine, engine_args, parse_tex_log};

use super::to_js;

/// [`engine_args`]: the argument vector for `engine` (`"latexmk"`, `"tectonic"` or `"pdflatex"`)
/// compiling `entry`.
///
/// # Errors
///
/// Fails if `engine` is not one of the known engine names, or the result cannot be converted to
/// JS.
#[wasm_bindgen(js_name = texEngineArgs, unchecked_return_type = "string[]")]
pub fn tex_engine_args_js(
    #[wasm_bindgen(unchecked_param_type = "B.TexEngineKind")] engine: JsValue,
    entry: &str,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let engine: TexEngine = serde_wasm_bindgen::from_value(engine)?;
    to_js(&engine_args(engine, entry))
}

/// [`parse_tex_log`]: the errors in a TeX log, one per place.
///
/// # Errors
///
/// Fails only if the result cannot be converted to JS.
#[wasm_bindgen(js_name = texLogErrors, unchecked_return_type = "B.TexErrorRow[]")]
pub fn tex_log_errors_js(log: &str, entry: &str) -> Result<JsValue, serde_wasm_bindgen::Error> {
    to_js(&parse_tex_log(log, entry))
}
