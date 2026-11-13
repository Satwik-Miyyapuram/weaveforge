//! Privacy-disclaimer shell gate for JavaScript (wf-core `privacy_disclaimer_readiness`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::privacy_disclaimer_readiness as gate;

/// [`should_mount_shell_children`](gate::should_mount_shell_children).
#[wasm_bindgen(js_name = shouldMountShellChildren)]
#[must_use]
pub fn should_mount_shell_children_js(
    loading: bool,
    needs_privacy_accept: bool,
    container_ready: bool,
) -> bool {
    gate::should_mount_shell_children(loading, needs_privacy_accept, container_ready)
}

/// [`should_show_workspace_loader`](gate::should_show_workspace_loader). `error` is the startup
/// error text, or nothing; an empty string counts as no error, as it does in JS.
#[wasm_bindgen(js_name = shouldShowWorkspaceLoader)]
#[must_use]
pub fn should_show_workspace_loader_js(
    loading: bool,
    needs_privacy_accept: bool,
    container_ready: bool,
    error: Option<String>,
) -> bool {
    let has_error = error.is_some_and(|text| !text.is_empty());
    gate::should_show_workspace_loader(loading, needs_privacy_accept, container_ready, has_error)
}
