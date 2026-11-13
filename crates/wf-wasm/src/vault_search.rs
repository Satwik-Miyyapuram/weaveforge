//! Vault folder rules for JavaScript (wf-core `vault_search`). The JS names match
//! `apps/shell/sidecar/src/vault-search.ts` and `vault-folder.ts`. Walks, reads, realpath and mkdir stay
//! in TypeScript.

use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::vault_search::{self, RootChoice, RootVerdict};

/// [`search_matches`](vault_search::search_matches): the matching lines of a file, cut for display.
#[wasm_bindgen(js_name = searchMatches)]
pub fn search_matches_js(text: &str, query: &str) -> Vec<String> {
    vault_search::search_matches(text, query)
}

/// [`is_search_file`](vault_search::is_search_file): whether the search reads this file.
#[wasm_bindgen(js_name = isSearchFile)]
pub fn is_search_file_js(path: &str) -> bool {
    vault_search::is_search_file(path)
}

/// [`is_skipped_dir`](vault_search::is_skipped_dir): whether the walk skips this directory.
#[wasm_bindgen(js_name = isSkippedDir)]
pub fn is_skipped_dir_js(path: &str) -> bool {
    vault_search::is_skipped_dir(path)
}

/// [`root_verdict`](vault_search::root_verdict) as `"notADirectory" | "existing" | "empty" | "notEmpty"`.
#[wasm_bindgen(js_name = rootVerdict)]
pub fn root_verdict_js(is_dir: bool, entries: Vec<String>, meta_dir: &str) -> String {
    let names: Vec<&str> = entries.iter().map(String::as_str).collect();
    match vault_search::root_verdict(is_dir, &names, meta_dir) {
        RootVerdict::NotADirectory => "notADirectory",
        RootVerdict::Existing => "existing",
        RootVerdict::Empty => "empty",
        RootVerdict::NotEmpty => "notEmpty",
    }
    .to_string()
}

/// [`choose_root`](vault_search::choose_root) as `"use" | "nest" | "refuse"`, from a verdict tag.
#[wasm_bindgen(js_name = chooseRoot)]
pub fn choose_root_js(verdict: &str) -> String {
    let verdict = match verdict {
        "existing" => RootVerdict::Existing,
        "empty" => RootVerdict::Empty,
        "notEmpty" => RootVerdict::NotEmpty,
        _ => RootVerdict::NotADirectory,
    };
    match vault_search::choose_root(verdict) {
        RootChoice::Use => "use",
        RootChoice::Nest => "nest",
        RootChoice::Refuse => "refuse",
    }
    .to_string()
}

/// [`temporary_name`](vault_search::temporary_name): the staged name for a write to `target`.
#[wasm_bindgen(js_name = temporaryName)]
pub fn temporary_name_js(target: &str, pid: u32, seq: u32) -> String {
    vault_search::temporary_name(target, pid, seq)
}

/// [`is_temporary_name`](vault_search::is_temporary_name): whether a listing must skip this entry.
#[wasm_bindgen(js_name = isTemporaryName)]
pub fn is_temporary_name_js(name: &str) -> bool {
    vault_search::is_temporary_name(name)
}
