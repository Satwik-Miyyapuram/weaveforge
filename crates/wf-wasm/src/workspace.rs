//! Offline-sync merge, ink notes, body diffs, markdown images, blob links and
//! folder layout for JavaScript (step 0b-4). Each export wraps a `wf-core`
//! function; the JS shapes match `packages/core`.

use serde::Serialize;
use serde_json::{Map, Value};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::sync::blob_links::{
    from_relative_blob_links_mapped, owned_asset_folder_paths, plan_asset_reanchor,
    relative_asset_paths, to_relative_blob_links, workspace_bodies,
};
use wf_core::sync::folder_layout::{
    ENTITY_DIRS, WorkspaceEntityType, WorkspaceProject, entity_dir, id_suffix, project_dir,
    project_meta_dir, strip_kind_suffix,
};
use wf_core::sync::ink_note::{
    InkNoteMeta, default_ink_note_meta, is_ink_chunk_id, is_ink_note_body, read_ink_note_body,
    readable_text, write_ink_note_body,
};
use wf_core::sync::json_entities::{WorkspaceJsonKind, is_app_owned_path, json_kind_of_path};
use wf_core::sync::markdown_image::{
    find_image_refs, image_alt_from_filename, image_extension_for_mime, image_paths_in_body,
    markdown_image, normalize_markdown_image_syntax,
};
use wf_core::sync::merge::{merge_rows, same_value};
use wf_core::sync::text_diff::{diff_body, has_conflict_markers};

use super::{check_text, to_js};

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`wf_core::sync::merge::merge_rows`] for JS, as `{ merged, conflicts }`.
///
/// # Errors
///
/// Fails when a row is not a plain object of JSON values.
#[wasm_bindgen(js_name = mergeRows)]
pub fn merge_rows_js(base: JsValue, local: JsValue, remote: JsValue) -> JsResult<JsValue> {
    let base: Map<String, Value> = serde_wasm_bindgen::from_value(base)?;
    let local: Map<String, Value> = serde_wasm_bindgen::from_value(local)?;
    let remote: Map<String, Value> = serde_wasm_bindgen::from_value(remote)?;
    to_js(&merge_rows(&base, &local, &remote))
}

/// [`wf_core::sync::merge::same_value`] for JS.
///
/// # Errors
///
/// Fails when a value is not JSON.
#[wasm_bindgen(js_name = sameValue)]
pub fn same_value_js(a: JsValue, b: JsValue) -> JsResult<bool> {
    let a: Value = serde_wasm_bindgen::from_value(a)?;
    let b: Value = serde_wasm_bindgen::from_value(b)?;
    Ok(same_value(&a, &b))
}

/// `{ meta, text }`, as `readInkNoteBody` returns it.
#[derive(Serialize)]
struct InkNoteBodyJs {
    meta: InkNoteMeta,
    text: String,
}

/// [`wf_core::sync::ink_note::is_ink_chunk_id`] for JS.
///
/// # Errors
///
/// Fails when `text` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = isInkChunkId)]
pub fn is_ink_chunk_id_js(text: js_sys::JsString) -> JsResult<bool> {
    let text = &crate::guarded_text(&text)?;
    Ok(is_ink_chunk_id(text))
}

/// [`wf_core::sync::ink_note::is_ink_note_body`] for JS.
///
/// # Errors
///
/// Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = isInkNoteBody)]
pub fn is_ink_note_body_js(body: js_sys::JsString) -> JsResult<bool> {
    let body = &crate::guarded_text(&body)?;
    Ok(is_ink_note_body(body))
}

/// [`wf_core::sync::ink_note::read_ink_note_body`] for JS, as `{ meta, text }`.
///
/// # Errors
///
/// Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = readInkNoteBody, unchecked_return_type = "{ meta: B.InkNoteMeta; text: string }")]
pub fn read_ink_note_body_js(body: js_sys::JsString) -> JsResult<JsValue> {
    let body = &crate::guarded_text(&body)?;
    let (meta, text) = read_ink_note_body(body);
    to_js(&InkNoteBodyJs { meta, text })
}

/// [`wf_core::sync::ink_note::readable_text`] for JS: a note's words, ink pages joined.
///
/// # Errors
///
/// Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = readableText)]
pub fn readable_text_js(body: js_sys::JsString) -> JsResult<String> {
    let body = &crate::guarded_text(&body)?;
    Ok(readable_text(body))
}

/// [`wf_core::sync::ink_note::write_ink_note_body`] for JS.
///
/// # Errors
///
/// Fails when `text` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when
/// `meta` is not an `InkNoteMeta` (unknown paper or hand included).
#[wasm_bindgen(js_name = writeInkNoteBody)]
pub fn write_ink_note_body_js(
    #[wasm_bindgen(
        unchecked_param_type = "Omit<B.InkNoteMeta, \"pageOrder\"> & { readonly pageOrder: readonly string[] }"
    )]
    meta: JsValue,
    text: js_sys::JsString,
) -> JsResult<String> {
    let text = &crate::guarded_text(&text)?;
    let meta: InkNoteMeta = serde_wasm_bindgen::from_value(meta)?;
    Ok(write_ink_note_body(&meta, text))
}

/// [`wf_core::sync::ink_note::default_ink_note_meta`] for JS.
///
/// # Errors
///
/// Fails only if the value cannot be converted to a JS value.
#[wasm_bindgen(js_name = defaultInkNoteMeta, unchecked_return_type = "B.InkNoteMeta")]
pub fn default_ink_note_meta_js() -> JsResult<JsValue> {
    to_js(&default_ink_note_meta())
}

/// [`wf_core::sync::text_diff::diff_body`] for JS, as `BodyDiff`.
///
/// # Errors
///
/// Fails when either text is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = diffBody, unchecked_return_type = "B.BodyDiff")]
pub fn diff_body_js(ours: js_sys::JsString, theirs: js_sys::JsString) -> JsResult<JsValue> {
    let ours = &crate::guarded_text(&ours)?;
    let theirs = &crate::guarded_text(&theirs)?;
    to_js(&diff_body(ours, theirs))
}

/// [`wf_core::sync::text_diff::has_conflict_markers`] for JS.
///
/// # Errors
///
/// Fails when `text` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = hasConflictMarkers)]
pub fn has_conflict_markers_js(text: js_sys::JsString) -> JsResult<bool> {
    let text = &crate::guarded_text(&text)?;
    Ok(has_conflict_markers(text))
}

/// [`wf_core::sync::markdown_image::markdown_image`] for JS.
///
/// # Errors
///
/// Fails when an argument is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = markdownImage)]
pub fn markdown_image_js(target: js_sys::JsString, alt: js_sys::JsString) -> JsResult<String> {
    let target = &crate::guarded_text(&target)?;
    let alt = &crate::guarded_text(&alt)?;
    Ok(markdown_image(target, alt))
}

/// [`wf_core::sync::markdown_image::image_alt_from_filename`] for JS.
///
/// # Errors
///
/// Fails when `name` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = imageAltFromFilename)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes optional strings by value"
)]
pub fn image_alt_from_filename_js(name: Option<js_sys::JsString>) -> JsResult<String> {
    let name = name.map(|name| crate::guarded_text(&name)).transpose()?;
    if let Some(name) = &name {
        check_text(name)?;
    }
    Ok(image_alt_from_filename(name.as_deref()))
}

/// [`wf_core::sync::markdown_image::image_extension_for_mime`] for JS.
///
/// # Errors
///
/// Fails when `mime` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = imageExtensionForMime)]
pub fn image_extension_for_mime_js(mime: js_sys::JsString) -> JsResult<String> {
    let mime = &crate::guarded_text(&mime)?;
    Ok(image_extension_for_mime(mime).to_owned())
}

/// [`wf_core::sync::markdown_image::find_image_refs`] for JS, with one `head`.
///
/// # Errors
///
/// Fails when `body` or `head` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = findImageRefs, unchecked_return_type = "B.FoundImageRef[]")]
pub fn find_image_refs_js(
    body: js_sys::JsString,
    head: js_sys::JsString,
    allow_space: bool,
) -> JsResult<JsValue> {
    let body = &crate::guarded_text(&body)?;
    let head = &crate::guarded_text(&head)?;
    to_js(&find_image_refs(body, &[head], allow_space))
}

/// [`wf_core::sync::markdown_image::image_paths_in_body`] for JS. The body is
/// always normalised with `normalize_markdown_image_syntax` first, as every
/// TS caller does; `prefix` is literal text, not a regex.
///
/// # Errors
///
/// Fails when `body` or `prefix` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = imagePathsInBody)]
pub fn image_paths_in_body_js(
    body: js_sys::JsString,
    prefix: js_sys::JsString,
) -> JsResult<Vec<String>> {
    let body = &crate::guarded_text(&body)?;
    let prefix = &crate::guarded_text(&prefix)?;
    Ok(image_paths_in_body(
        body,
        prefix,
        normalize_markdown_image_syntax,
    ))
}

/// [`wf_core::sync::markdown_image::normalize_markdown_image_syntax`] for JS.
///
/// # Errors
///
/// Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = normalizeMarkdownImageSyntax)]
pub fn normalize_markdown_image_syntax_js(body: js_sys::JsString) -> JsResult<String> {
    let body = &crate::guarded_text(&body)?;
    Ok(normalize_markdown_image_syntax(body))
}

/// [`wf_core::sync::blob_links::to_relative_blob_links`] for JS, as
/// `{ body, assets: [{ scheme, storagePath, folderPath }] }`.
///
/// # Errors
///
/// Fails when `body` or `file_path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = toRelativeBlobLinks, unchecked_return_type = "B.RelativeLinks")]
pub fn to_relative_blob_links_js(
    body: js_sys::JsString,
    file_path: js_sys::JsString,
) -> JsResult<JsValue> {
    let body = &crate::guarded_text(&body)?;
    let file_path = &crate::guarded_text(&file_path)?;
    to_js(&to_relative_blob_links(body, file_path))
}

/// [`wf_core::sync::blob_links::relative_asset_paths`] for JS, as `[{ scope, path }]`.
///
/// # Errors
///
/// Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = relativeAssetPaths, unchecked_return_type = "B.RelativeAsset[]")]
pub fn relative_asset_paths_js(body: js_sys::JsString) -> JsResult<JsValue> {
    let body = &crate::guarded_text(&body)?;
    to_js(&relative_asset_paths(body))
}

/// [`wf_core::sync::blob_links::owned_asset_folder_paths`] for JS. `bodies` is an array
/// of strings; the result is the sorted array of folder paths they point at.
///
/// # Errors
///
/// Fails when `bodies` is not an array of strings, or a body is over `MAX_INDEX_TEXT_UTF16`
/// UTF-16 units.
#[wasm_bindgen(js_name = ownedAssetFolderPaths)]
pub fn owned_asset_folder_paths_js(bodies: JsValue) -> JsResult<JsValue> {
    let bodies: Vec<String> = serde_wasm_bindgen::from_value(bodies)?;
    for body in &bodies {
        check_text(body)?;
    }
    to_js(&owned_asset_folder_paths(&bodies))
}

/// [`wf_core::sync::blob_links::workspace_bodies`] for JS. `vaultBodies` is an array of
/// strings and `paperSummaries` an array of strings or `null`; the result is the bodies,
/// vault pages first, a missing summary as an empty body.
///
/// # Errors
///
/// Fails when either argument is not an array of the expected element type.
#[wasm_bindgen(js_name = workspaceBodies)]
pub fn workspace_bodies_js(vault_bodies: JsValue, paper_summaries: JsValue) -> JsResult<JsValue> {
    let vault_bodies: Vec<String> = serde_wasm_bindgen::from_value(vault_bodies)?;
    let paper_summaries: Vec<Option<String>> = serde_wasm_bindgen::from_value(paper_summaries)?;
    to_js(&workspace_bodies(&vault_bodies, &paper_summaries))
}

/// [`wf_core::sync::blob_links::plan_asset_reanchor`] for JS. `owned` and `available` are
/// arrays of folder paths; the result is `{ keep, upload, unresolved }`.
///
/// # Errors
///
/// Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or `owned` or `available`
/// is not an array of strings.
#[wasm_bindgen(js_name = planAssetReanchor, unchecked_return_type = "B.ReanchorPlan")]
pub fn plan_asset_reanchor_js(
    body: js_sys::JsString,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] owned: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly string[]")] available: JsValue,
) -> JsResult<JsValue> {
    let body = &crate::guarded_text(&body)?;
    let owned: std::collections::BTreeSet<String> = serde_wasm_bindgen::from_value(owned)?;
    let available: std::collections::BTreeSet<String> = serde_wasm_bindgen::from_value(available)?;
    to_js(&plan_asset_reanchor(body, &owned, &available))
}

/// [`wf_core::sync::blob_links::from_relative_blob_links_mapped`] for JS. `resolved`
/// is `{ "assets/<scope>/<path>": storagePath }`.
///
/// # Errors
///
/// Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or `resolved` is
/// not an object of strings.
#[wasm_bindgen(js_name = fromRelativeBlobLinks)]
pub fn from_relative_blob_links_js(
    body: js_sys::JsString,
    #[wasm_bindgen(unchecked_param_type = "Readonly<Record<string, string>>")] resolved: JsValue,
) -> JsResult<String> {
    let body = &crate::guarded_text(&body)?;
    let map: std::collections::BTreeMap<String, String> = serde_wasm_bindgen::from_value(resolved)?;
    Ok(from_relative_blob_links_mapped(body, &map))
}

/// The entity type named `name` (`"vault_page"`, `"paper"`, ...).
fn entity_type(name: &str) -> Option<WorkspaceEntityType> {
    ENTITY_DIRS
        .iter()
        .map(|(entity, _)| *entity)
        .find(|entity| entity.as_str() == name)
}

/// [`wf_core::sync::folder_layout::project_dir`] for JS.
///
/// # Errors
///
/// Fails when `id` or `name` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = projectDir)]
pub fn project_dir_js(id: js_sys::JsString, name: js_sys::JsString) -> JsResult<String> {
    let id = &crate::guarded_text(&id)?;
    let name = &crate::guarded_text(&name)?;
    Ok(project_dir(&WorkspaceProject {
        id: id.to_owned(),
        name: name.to_owned(),
    }))
}

/// [`wf_core::sync::folder_layout::entity_dir`] for JS.
///
/// # Errors
///
/// Fails when `entity` is not a workspace entity type, or `project_root` is
/// over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = entityDir)]
pub fn entity_dir_js(entity: &str, project_root: js_sys::JsString) -> JsResult<String> {
    let project_root = &crate::guarded_text(&project_root)?;
    let entity = entity_type(entity)
        .ok_or_else(|| serde_wasm_bindgen::Error::new(format!("unknown entity type {entity:?}")))?;
    Ok(entity_dir(entity, project_root))
}

/// [`wf_core::sync::folder_layout::project_meta_dir`] for JS.
///
/// # Errors
///
/// Fails when `project_root` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = projectMetaDir)]
pub fn project_meta_dir_js(project_root: js_sys::JsString) -> JsResult<String> {
    let project_root = &crate::guarded_text(&project_root)?;
    Ok(project_meta_dir(project_root))
}

/// [`wf_core::sync::folder_layout::id_suffix`] for JS.
///
/// # Errors
///
/// Fails when `id` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = idSuffix)]
pub fn id_suffix_js(id: js_sys::JsString) -> JsResult<String> {
    let id = &crate::guarded_text(&id)?;
    Ok(id_suffix(id))
}

/// [`wf_core::sync::folder_layout::strip_kind_suffix`] for JS.
///
/// # Errors
///
/// Fails when `name` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = stripKindSuffix)]
pub fn strip_kind_suffix_js(name: js_sys::JsString) -> JsResult<String> {
    let name = &crate::guarded_text(&name)?;
    Ok(strip_kind_suffix(name))
}

const fn json_kind_name(kind: WorkspaceJsonKind) -> &'static str {
    match kind {
        WorkspaceJsonKind::Relations => "relations",
        WorkspaceJsonKind::Tags => "tags",
        WorkspaceJsonKind::ReadingListItems => "reading_list_items",
    }
}

/// [`wf_core::sync::json_entities::json_kind_of_path`] for JS; `undefined` for none.
///
/// # Errors
///
/// Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = jsonKindOfPath)]
pub fn json_kind_of_path_js(path: js_sys::JsString) -> JsResult<Option<String>> {
    let path = &crate::guarded_text(&path)?;
    Ok(json_kind_of_path(path).map(|kind| json_kind_name(kind).to_owned()))
}

/// [`wf_core::sync::json_entities::is_app_owned_path`] for JS.
///
/// # Errors
///
/// Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
#[wasm_bindgen(js_name = isAppOwnedPath)]
pub fn is_app_owned_path_js(path: js_sys::JsString) -> JsResult<bool> {
    let path = &crate::guarded_text(&path)?;
    Ok(is_app_owned_path(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_entity_type_name_parses() {
        for name in [
            "vault_page",
            "ink_page",
            "paper",
            "reading_list",
            "report_section",
            "experiment",
            "milestone",
            "log_entry",
        ] {
            assert_eq!(
                entity_type(name).map(WorkspaceEntityType::as_str),
                Some(name)
            );
        }
        assert_eq!(entity_type("vault"), None);
    }

    #[test]
    fn json_kind_names_match_serde() {
        for kind in wf_core::sync::json_entities::JSON_KINDS {
            assert_eq!(
                serde_json::to_value(kind).ok(),
                Some(Value::from(json_kind_name(kind)))
            );
        }
    }

    #[test]
    fn ink_meta_round_trips_through_the_js_shape() {
        let meta = default_ink_note_meta();
        let json = serde_json::to_value(&meta).ok();
        assert_eq!(
            json,
            Some(serde_json::json!({
                "pages": 1, "paper": "blank", "pageOrder": [], "recognised": 0.0, "engine": null, "hand": "right"
            }))
        );
        let back: Option<InkNoteMeta> = json.and_then(|v| serde_json::from_value(v).ok());
        assert_eq!(back, Some(meta));
    }

    #[test]
    fn unknown_ink_paper_is_rejected() {
        let bad = serde_json::json!({
            "pages": 1, "paper": "weird", "pageOrder": [], "recognised": 0, "engine": null, "hand": "right"
        });
        assert!(serde_json::from_value::<InkNoteMeta>(bad).is_err());
    }
}
