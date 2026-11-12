//! Renamed project folder pick for JavaScript (wf-core `workspace::project_rename`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::workspace::project_rename;

/// [`pick_renamed_folder`](project_rename::pick_renamed_folder): the one of `dirs` ending with
/// `tail`, or `undefined` when none or several match.
#[wasm_bindgen(js_name = pickRenamedFolder)]
pub fn pick_renamed_folder_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] dirs: Vec<String>,
    tail: &str,
) -> Option<String> {
    project_rename::pick_renamed_folder(&dirs, tail)
}
