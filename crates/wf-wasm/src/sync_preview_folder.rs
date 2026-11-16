//! Folder preview read rule for JavaScript (wf-core `sync::preview_folder::reads_folder`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::preview_folder;

/// [`reads_folder`](preview_folder::reads_folder).
#[wasm_bindgen(js_name = readsFolder)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn reads_folder_js(name: String, project_root: String, has_project_dir: bool) -> bool {
    preview_folder::reads_folder(&name, &project_root, has_project_dir)
}
