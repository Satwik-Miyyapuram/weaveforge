//! Vault page helpers for JavaScript (wf-core `vault::page`): wikilinks, frontmatter, titles
//! and note previews. The markdown image helpers are exported from `workspace.rs`.
//!
//! The TS wrappers in `packages/wf-wasm/src/vault-page.ts` apply the `undefined` handling and
//! the defaults.

use std::collections::{HashMap, HashSet};

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::vault::page::{self, DerivedNote};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// Notes as objects with `id`, `title`, and `body` or `bodyPreview`, from TS.
fn notes_from(value: JsValue) -> JsResult<Vec<DerivedNote>> {
    serde_wasm_bindgen::from_value(value)
}

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

/// [`note_backlinks`](page::note_backlinks) (TS `noteBacklinks`), as `{ id, title }` objects.
///
/// # Errors
///
/// Fails if `notes` has the wrong shape.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes the optional id by value"
)]
#[wasm_bindgen(js_name = noteBacklinks)]
pub fn note_backlinks_js(notes: JsValue, selected_id: Option<String>) -> JsResult<JsValue> {
    let notes = notes_from(notes)?;
    to_js(&page::note_backlinks(&notes, selected_id.as_deref()))
}

/// [`note_tags`](page::note_tags) (TS `noteTags`): the distinct hashtags, sorted by UTF-16 order.
///
/// # Errors
///
/// Fails if `notes` has the wrong shape.
#[wasm_bindgen(js_name = noteTags)]
pub fn note_tags_js(notes: JsValue) -> JsResult<Vec<String>> {
    Ok(page::note_tags(&notes_from(notes)?))
}

/// [`scope_notes`](page::scope_notes) (TS `scopeNotes`): the indices of the notes that pass the
/// list and tag filters. `membership` is an object of list id to an array of note ids.
///
/// # Errors
///
/// Fails if an argument has the wrong shape.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[wasm_bindgen(js_name = scopeNoteIndices)]
pub fn scope_note_indices_js(
    notes: JsValue,
    list_filter: Vec<String>,
    tag_filter: Vec<String>,
    membership: JsValue,
) -> JsResult<JsValue> {
    let notes = notes_from(notes)?;
    let membership: HashMap<String, HashSet<String>> = serde_wasm_bindgen::from_value(membership)?;
    to_js(&page::scope_notes(
        &notes,
        &list_filter,
        &tag_filter,
        &membership,
    ))
}

/// [`embed_titles`](page::embed_titles): the trimmed title of each `![[...]]` in `body`.
#[wasm_bindgen(js_name = embedTitles)]
#[must_use]
pub fn embed_titles_js(body: &str) -> Vec<String> {
    page::embed_titles(body)
}

/// [`expand_embeds`](page::expand_embeds): `bodies[i]` is the body that `titles[i]` resolves to.
#[wasm_bindgen(js_name = expandEmbeds)]
#[must_use]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn expand_embeds_js(body: &str, titles: Vec<String>, bodies: Vec<String>) -> String {
    page::expand_embeds(body, &titles, &bodies)
}

/// [`replace_vault_asset_paths`](page::replace_vault_asset_paths): `old_paths[i]` becomes `new_paths[i]`.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes arrays by value"
)]
#[wasm_bindgen(js_name = replaceVaultAssetPaths)]
#[must_use]
pub fn replace_vault_asset_paths_js(
    body: &str,
    old_paths: Vec<String>,
    new_paths: Vec<String>,
) -> String {
    let pairs: Vec<(String, String)> = old_paths.into_iter().zip(new_paths).collect();
    page::replace_vault_asset_paths(body, &pairs)
}
