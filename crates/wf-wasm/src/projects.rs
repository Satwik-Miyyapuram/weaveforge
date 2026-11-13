//! Project rules for JavaScript, via `wasm-bindgen` (wf-core `projects::project_name`). The JS
//! name matches `packages/core/src/features/projects/domain/parts.ts`.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::projects::project_name;

/// [`project_name`](project_name): the trimmed name, or `undefined` when blank.
#[wasm_bindgen(js_name = projectName)]
pub fn project_name_js(name: &str) -> Option<String> {
    project_name(name)
}
