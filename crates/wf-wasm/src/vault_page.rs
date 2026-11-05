//! Vault page helpers for JavaScript (wf-core `vault::page`): wikilinks, frontmatter, titles
//! and note previews. The markdown image helpers are exported from `workspace.rs`.
//!
//! The TS wrappers in `packages/wf-wasm/src/vault-page.ts` apply the `undefined` handling and
//! the defaults.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::vault::page;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`parse_wikilink_inner`](page::parse_wikilink_inner) (TS `parseWikilinkInner`).
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = parseWikilinkInner)]
pub fn parse_wikilink_inner_js(inner: &str, raw: &str) -> JsResult<JsValue> {
    to_js(&page::parse_wikilink_inner(inner, raw))
}

/// [`extract_wikilinks`](page::extract_wikilinks) (TS `extractWikilinks`). Offsets are UTF-16.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = extractWikilinks)]
pub fn extract_wikilinks_js(body: &str) -> JsResult<JsValue> {
    to_js(&page::extract_wikilinks(body))
}

/// [`normalize_title_key`](page::normalize_title_key) (TS `normalizeTitleKey`).
#[wasm_bindgen(js_name = normalizeTitleKey)]
#[must_use]
pub fn normalize_title_key_js(title: &str) -> String {
    page::normalize_title_key(title)
}

/// [`body_links_to`](page::body_links_to) (TS `bodyLinksTo`).
#[wasm_bindgen(js_name = bodyLinksTo)]
#[must_use]
pub fn body_links_to_js(body: &str, target_key: &str) -> bool {
    page::body_links_to(body, target_key)
}

/// [`strip_frontmatter`](page::strip_frontmatter) (TS `stripFrontmatter`).
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = stripFrontmatter)]
pub fn strip_frontmatter_js(md: &str) -> JsResult<JsValue> {
    to_js(&page::strip_frontmatter(md))
}

/// [`unique_title`](page::unique_title) (TS `uniqueTitle`). `used` holds normalized keys.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[wasm_bindgen(js_name = uniqueTitle)]
#[must_use]
pub fn unique_title_js(base: &str, used: Vec<String>) -> String {
    page::unique_title(base, &used)
}

/// [`vault_image_markdown`](page::vault_image_markdown) (TS `vaultImageMarkdown`).
#[wasm_bindgen(js_name = vaultImageMarkdown)]
#[must_use]
pub fn vault_image_markdown_js(path: &str, alt: &str) -> String {
    page::vault_image_markdown(path, alt)
}

/// [`vault_asset_paths_in_body`](page::vault_asset_paths_in_body) (TS `vaultAssetPathsInBody`).
#[wasm_bindgen(js_name = vaultAssetPathsInBody)]
#[must_use]
pub fn vault_asset_paths_in_body_js(body: &str) -> Vec<String> {
    page::vault_asset_paths_in_body(body)
}

/// [`vault_body_preview`](page::vault_body_preview) (TS `vaultBodyPreview`). `max` counts UTF-16
/// units.
#[wasm_bindgen(js_name = vaultBodyPreview)]
#[must_use]
pub fn vault_body_preview_js(body: &str, max: usize) -> String {
    page::vault_body_preview(body, max)
}
