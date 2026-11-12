//! The MCP project pick for JavaScript (wf-core `sync::project_pick`). The JS name matches
//! `apps/shell/sidecar/src/local-mcp-projects.ts`.

use wasm_bindgen::prelude::{JsError, JsValue, wasm_bindgen};
use wf_core::sync::project_pick::{self, ProjectRef};

/// [`pick_project`](project_pick::pick_project): the index of the picked project.
///
/// # Errors
///
/// Throws an `Error` whose message names the miss or the ambiguity, or the shape error when
/// `projects` is not a list of projects.
#[wasm_bindgen(js_name = pickProject)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn pick_project_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.PickableProject[]")] projects: JsValue,
    needle: Option<String>,
) -> Result<usize, JsError> {
    let projects: Vec<ProjectRef> = serde_wasm_bindgen::from_value(projects)
        .map_err(|error| JsError::new(&error.to_string()))?;
    project_pick::pick_project(&projects, needle.as_deref())
        .map_err(|message| JsError::new(&message))
}
