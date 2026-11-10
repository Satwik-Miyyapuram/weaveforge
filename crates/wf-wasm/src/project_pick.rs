//! The MCP project pick for JavaScript (wf-core `sync::project_pick`). The JS name matches
//! `apps/shell/sidecar/src/local-mcp-projects.ts`.

use wasm_bindgen::prelude::{JsValue, wasm_bindgen};
use wf_core::sync::project_pick::{self, ProjectRef};

/// [`pick_project`](project_pick::pick_project): the index of the picked project. A miss or an
/// ambiguous match throws the message as a string; the TS wrapper turns it into an `Error`.
#[wasm_bindgen(js_name = pickProject)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn pick_project_js(projects: JsValue, needle: Option<String>) -> Result<usize, String> {
    let projects: Vec<ProjectRef> =
        serde_wasm_bindgen::from_value(projects).map_err(|error| error.to_string())?;
    project_pick::pick_project(&projects, needle.as_deref())
}
