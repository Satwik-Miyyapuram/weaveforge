//! The git error-line pick for JavaScript (wf-core `sync::git_reason`). The JS name matches
//! `apps/shell/sidecar/src/vault-git.ts`; reading the text off the error stays in TypeScript.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::git_reason;

/// [`git_reason`](git_reason::git_reason): git's `fatal:`/`error:` lines from a failed command's text.
#[wasm_bindgen(js_name = gitReason)]
#[must_use]
pub fn git_reason_js(text: &str) -> String {
    git_reason::git_reason(text)
}
