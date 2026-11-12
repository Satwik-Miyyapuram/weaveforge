//! Path and status decisions for the isomorphic-git fs shim (wf-core `workspace::git_shim`).

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::workspace::git_shim;

/// [`normalize_repo_path`](git_shim::normalize_repo_path): repo-relative path, `""` for the root.
#[wasm_bindgen(js_name = normalizeRepoPath)]
pub fn normalize_repo_path_js(path: &str) -> String {
    git_shim::normalize_repo_path(path)
}

/// [`git_status_state`](git_shim::git_status_state): `"added"`, `"deleted"`, `"modified"`, or
/// `undefined` for an unchanged `statusMatrix` row.
#[wasm_bindgen(js_name = gitStatusState)]
pub fn git_status_state_js(head: u8, workdir: u8) -> Option<String> {
    git_shim::git_status_state(head, workdir).map(str::to_owned)
}

/// [`unstage_action`](git_shim::unstage_action): `"keep"`, `"remove"` or `"reset"`.
#[wasm_bindgen(js_name = unstageAction)]
pub fn unstage_action_js(head: u8, stage: u8) -> String {
    git_shim::unstage_action(head, stage).as_str().to_owned()
}

/// [`out_of_scope_strays`](git_shim::out_of_scope_strays): indexed paths to recheck when
/// unstaging out-of-scope entries.
#[wasm_bindgen(js_name = outOfScopeStrays)]
pub fn out_of_scope_strays_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] indexed: Vec<String>,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] kept: Vec<String>,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] skipped: Vec<String>,
    max_file_bytes: f64,
) -> Vec<String> {
    git_shim::out_of_scope_strays(&indexed, &kept, &skipped, max_file_bytes)
}

/// [`dir_entry_names`](git_shim::dir_entry_names): direct child names of `dir`, UTF-16 sorted.
#[wasm_bindgen(js_name = dirEntryNames)]
pub fn dir_entry_names_js(
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] paths: Vec<String>,
    dir: &str,
) -> Vec<String> {
    git_shim::dir_entry_names(&paths, dir)
}

/// [`split_leaf`](git_shim::split_leaf): `[parent, name]` for a repo-relative path.
#[wasm_bindgen(js_name = splitLeaf)]
pub fn split_leaf_js(path: &str) -> Vec<String> {
    git_shim::split_leaf(path)
}
