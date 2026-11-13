//! Vault page helpers for JavaScript (wf-core `vault::page`): wikilinks, frontmatter, titles
//! and note previews. The markdown image helpers are exported from `workspace.rs`.
//!
//! The names and defaults match the `VaultPage` contract in
//! `packages/core/src/shared/core-contract.ts`.

use std::collections::{HashMap, HashSet};

use js_sys::{Array, Map, Set};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::vault::asset_copy::{self, AssetCopy};
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
#[wasm_bindgen(js_name = parseWikilinkInner, unchecked_return_type = "B.WikilinkRef | null")]
pub fn parse_wikilink_inner_js(inner: &str, raw: &str) -> JsResult<JsValue> {
    to_js(&page::parse_wikilink_inner(inner, raw))
}

/// [`extract_wikilinks`](page::extract_wikilinks) (TS `extractWikilinks`). Offsets are UTF-16;
/// a missing or empty body has none.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes the optional body by value"
)]
#[wasm_bindgen(js_name = extractWikilinks, unchecked_return_type = "B.WikilinkRef[]")]
pub fn extract_wikilinks_js(body: Option<String>) -> JsResult<JsValue> {
    match body.as_deref() {
        Some(body) if !body.is_empty() => to_js(&page::extract_wikilinks(body)),
        _ => Ok(Array::new().into()),
    }
}

/// [`normalize_title_key`](page::normalize_title_key) (TS `normalizeTitleKey`).
#[wasm_bindgen(js_name = normalizeTitleKey)]
#[must_use]
pub fn normalize_title_key_js(title: &str) -> String {
    page::normalize_title_key(title)
}

/// [`body_links_to`](page::body_links_to) (TS `bodyLinksTo`); a missing or empty body links
/// nowhere.
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes the optional body by value"
)]
#[wasm_bindgen(js_name = bodyLinksTo)]
#[must_use]
pub fn body_links_to_js(
    body: Option<String>,
    #[wasm_bindgen(js_name = targetKey)] target_key: &str,
) -> bool {
    match body.as_deref() {
        Some(body) if !body.is_empty() => page::body_links_to(body, target_key),
        _ => false,
    }
}

/// [`strip_frontmatter`](page::strip_frontmatter) (TS `stripFrontmatter`).
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = stripFrontmatter, unchecked_return_type = "B.ParsedFrontmatter")]
pub fn strip_frontmatter_js(md: &str) -> JsResult<JsValue> {
    to_js(&page::strip_frontmatter(md))
}

/// [`unique_title`](page::unique_title) (TS `uniqueTitle`): a title unique against `used`
/// (normalized keys). Records the chosen title's key in `used`.
///
/// # Errors
///
/// Fails if `used` holds a value that is not a string.
#[wasm_bindgen(js_name = uniqueTitle)]
pub fn unique_title_js(
    base: &str,
    #[wasm_bindgen(unchecked_param_type = "Set<string>")] used: &Set,
) -> JsResult<String> {
    let keys: Vec<String> = serde_wasm_bindgen::from_value(Array::from(used).into())?;
    let title = page::unique_title(base, &keys);
    let _ = used.add(&JsValue::from_str(&page::normalize_title_key(&title)));
    Ok(title)
}

/// [`vault_image_markdown`](page::vault_image_markdown) (TS `vaultImageMarkdown`).
#[wasm_bindgen(js_name = vaultImageMarkdown)]
#[must_use]
pub fn vault_image_markdown_js(path: &str, alt: Option<String>) -> String {
    page::vault_image_markdown(path, alt.as_deref().unwrap_or("image"))
}

/// [`vault_asset_paths_in_body`](page::vault_asset_paths_in_body) (TS `vaultAssetPathsInBody`).
#[wasm_bindgen(js_name = vaultAssetPathsInBody)]
#[must_use]
pub fn vault_asset_paths_in_body_js(body: &str) -> Vec<String> {
    page::vault_asset_paths_in_body(body)
}

/// [`vault_body_preview`](page::vault_body_preview) (TS `vaultBodyPreview`). `max` counts UTF-16
/// units and defaults to [`VAULT_BODY_PREVIEW_CHARS`](page::VAULT_BODY_PREVIEW_CHARS); an empty
/// body previews as empty.
#[wasm_bindgen(js_name = vaultBodyPreview)]
#[must_use]
pub fn vault_body_preview_js(body: &str, max: Option<usize>) -> String {
    if body.is_empty() {
        return String::new();
    }
    page::vault_body_preview(body, max.unwrap_or(page::VAULT_BODY_PREVIEW_CHARS))
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
#[wasm_bindgen(js_name = noteBacklinks, unchecked_return_type = "{ id: string; title: string }[]")]
pub fn note_backlinks_js(
    #[wasm_bindgen(unchecked_param_type = "readonly unknown[]")] notes: JsValue,
    #[wasm_bindgen(js_name = selectedId)] selected_id: Option<String>,
) -> JsResult<JsValue> {
    let notes = notes_from(notes)?;
    to_js(&page::note_backlinks(&notes, selected_id.as_deref()))
}

/// [`note_tags`](page::note_tags) (TS `noteTags`): the distinct hashtags, sorted by UTF-16 order.
///
/// # Errors
///
/// Fails if `notes` has the wrong shape.
#[wasm_bindgen(js_name = noteTags)]
pub fn note_tags_js(
    #[wasm_bindgen(unchecked_param_type = "readonly unknown[]")] notes: JsValue,
) -> JsResult<Vec<String>> {
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
#[wasm_bindgen(js_name = scopeNoteIndices, unchecked_return_type = "number[]")]
pub fn scope_note_indices_js(
    #[wasm_bindgen(unchecked_param_type = "readonly unknown[]")] notes: JsValue,
    #[wasm_bindgen(js_name = listFilter, unchecked_param_type = "readonly string[]")]
    list_filter: Vec<String>,
    #[wasm_bindgen(js_name = tagFilter, unchecked_param_type = "readonly string[]")]
    tag_filter: Vec<String>,
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, readonly string[]>>")]
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

/// [`expand_embeds`](page::expand_embeds): `body` with each embed whose title is in `resolved`
/// replaced by that note's body as a callout.
///
/// # Errors
///
/// Fails if `resolved` holds a key or value that is not a string.
#[wasm_bindgen(js_name = expandEmbeds)]
pub fn expand_embeds_js(
    body: &str,
    #[wasm_bindgen(unchecked_param_type = "ReadonlyMap<string, string>")] resolved: &Map,
) -> JsResult<String> {
    let titles: Vec<String> = serde_wasm_bindgen::from_value(Array::from(&resolved.keys()).into())?;
    let bodies: Vec<String> =
        serde_wasm_bindgen::from_value(Array::from(&resolved.values()).into())?;
    Ok(page::expand_embeds(body, &titles, &bodies))
}

/// One `vault:` path rewrite.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetRewrite {
    old_path: String,
    new_path: String,
}

/// [`replace_vault_asset_paths`](page::replace_vault_asset_paths): `body` with each
/// `vault:{oldPath}` rewritten to `vault:{newPath}`, in order.
///
/// # Errors
///
/// Fails if `rewrites` is not a list of `{ oldPath, newPath }` strings.
#[wasm_bindgen(js_name = replaceVaultAssetPaths)]
pub fn replace_vault_asset_paths_js(
    body: &str,
    #[wasm_bindgen(unchecked_param_type = "readonly { oldPath: string; newPath: string }[]")]
    rewrites: JsValue,
) -> JsResult<String> {
    let rewrites: Vec<AssetRewrite> = serde_wasm_bindgen::from_value(rewrites)?;
    let pairs: Vec<(String, String)> = rewrites
        .into_iter()
        .map(|rewrite| (rewrite.old_path, rewrite.new_path))
        .collect();
    Ok(page::replace_vault_asset_paths(body, &pairs))
}

/// [`plan_asset_copies`](asset_copy::plan_asset_copies): from each image's copy attempt
/// `{ oldPath, newPath | null }`, the `failedAssets` and the `rewrites` for the rest.
///
/// # Errors
///
/// Fails if `copies` is not a list of `{ oldPath, newPath }` objects with `newPath` a string or null.
#[wasm_bindgen(js_name = planAssetCopies, unchecked_return_type = "{ failedAssets: string[]; rewrites: { oldPath: string; newPath: string }[] }")]
pub fn plan_asset_copies_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly { oldPath: string; newPath: string | null }[]"
    )]
    copies: JsValue,
) -> JsResult<JsValue> {
    let copies: Vec<AssetCopy> = serde_wasm_bindgen::from_value(copies)?;
    to_js(&asset_copy::plan_asset_copies(&copies))
}

/// [`copy_extension`](asset_copy::copy_extension): the text after the last `.` in `oldPath`
/// (TS `oldPath.split(".").pop()`).
#[wasm_bindgen(js_name = copyExtension)]
#[must_use]
pub fn copy_extension_js(old_path: &str) -> String {
    asset_copy::copy_extension(old_path).to_owned()
}

/// [`VAULT_IMAGE_PREFIX`](page::VAULT_IMAGE_PREFIX) (TS `vaultImagePrefix()`).
#[wasm_bindgen(js_name = vaultImagePrefix)]
#[must_use]
pub fn vault_image_prefix_js() -> String {
    page::VAULT_IMAGE_PREFIX.to_string()
}

/// [`VAULT_BODY_PREVIEW_CHARS`](page::VAULT_BODY_PREVIEW_CHARS) (TS `vaultBodyPreviewChars()`).
#[wasm_bindgen(js_name = vaultBodyPreviewChars)]
#[must_use]
pub fn vault_body_preview_chars_js() -> usize {
    page::VAULT_BODY_PREVIEW_CHARS
}
