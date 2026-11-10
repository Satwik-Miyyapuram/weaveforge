//! Folder-draft import rules for JavaScript (wf-core `ai::folder_draft`). The JS names match
//! `apps/web/src/features/ai-assistant/application/import-folder-drafts.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::{JsError, wasm_bindgen};
use wf_core::ai::folder_draft;

use super::to_js;

/// [`is_folder_draft_path`](folder_draft::is_folder_draft_path): whether a file name is a draft.
#[wasm_bindgen(js_name = isFolderDraftPath)]
pub fn is_folder_draft_path_js(path: &str) -> bool {
    folder_draft::is_folder_draft_path(path)
}

/// [`folder_draft_for_project`](folder_draft::folder_draft_for_project): the parsed draft when it
/// belongs to the project, or `null`.
///
/// # Errors
///
/// Fails only if the result cannot be converted to a JS value.
#[wasm_bindgen(js_name = folderDraftForProject)]
pub fn folder_draft_for_project_js(
    raw: &str,
    project_id: Option<String>,
) -> Result<JsValue, JsError> {
    to_js(&folder_draft::folder_draft_for_project(
        raw,
        project_id.as_deref(),
    ))
    .map_err(|error| JsError::new(&error.to_string()))
}
