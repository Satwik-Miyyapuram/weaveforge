//! Project folder names (wf-core `project_folder`). The JS name matches
//! `apps/shell/sidecar/src/local-mcp-projects.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::project_folder;

/// [`project_folder_name`](project_folder::project_folder_name): the project a folder stands for, or `undefined`.
#[wasm_bindgen(js_name = projectFolderName)]
pub fn project_folder_name_js(dir: &str) -> Option<String> {
    project_folder::project_folder_name(dir).map(str::to_string)
}
