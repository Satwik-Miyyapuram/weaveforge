//! Whether a key press belongs to a text field (wf-core `editor_workspace::typing_target`). The TS
//! wrapper `packages/wf-wasm/src/editor-workspace-typing-target.ts` gives it its type.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::editor_workspace::typing_target;

/// [`is_typing_target`](typing_target::is_typing_target) on the element's tag name and editability.
#[wasm_bindgen(js_name = isTypingTarget)]
pub fn is_typing_target(tag_name: Option<String>, is_content_editable: bool) -> bool {
    typing_target::is_typing_target(tag_name.as_deref(), is_content_editable)
}
