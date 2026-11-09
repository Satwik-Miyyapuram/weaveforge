//! Graph tag helpers for JavaScript (wf-core `relations::graph_tags`). The JS names
//! match `apps/web/src/features/relations/application/graph-tags.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::relations::graph_tags::{self, NamedList, TaggedNote, TaggedPaper};

use super::to_js;

/// [`graph_tag_names`](graph_tags::graph_tag_names): every filterable tag, sorted.
///
/// # Errors
///
/// Fails if `papers`, `notes` or `lists` has the wrong shape.
#[wasm_bindgen(js_name = graphTagNames)]
pub fn graph_tag_names_js(
    papers: JsValue,
    notes: JsValue,
    lists: JsValue,
    include_lists: bool,
) -> Result<JsValue, JsValue> {
    let papers: Vec<TaggedPaper> = serde_wasm_bindgen::from_value(papers)?;
    let notes: Vec<TaggedNote> = serde_wasm_bindgen::from_value(notes)?;
    let lists: Vec<NamedList> = serde_wasm_bindgen::from_value(lists)?;
    Ok(to_js(&graph_tags::graph_tag_names(
        &papers,
        &notes,
        &lists,
        include_lists,
    ))?)
}

/// [`related_concepts`](graph_tags::related_concepts): the top `limit` tags seen beside `name`.
///
/// # Errors
///
/// Fails if `papers` or `notes` has the wrong shape.
#[wasm_bindgen(js_name = relatedConcepts)]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn related_concepts_js(
    name: String,
    papers: JsValue,
    notes: JsValue,
    limit: u32,
) -> Result<JsValue, JsValue> {
    let papers: Vec<TaggedPaper> = serde_wasm_bindgen::from_value(papers)?;
    let notes: Vec<TaggedNote> = serde_wasm_bindgen::from_value(notes)?;
    Ok(to_js(&graph_tags::related_concepts(
        &name,
        &papers,
        &notes,
        limit as usize,
    ))?)
}

/// [`notes_tagged`](graph_tags::notes_tagged): indices of the notes matching `tags`.
///
/// # Errors
///
/// Fails if `notes` or `tags` has the wrong shape.
#[wasm_bindgen(js_name = notesTagged)]
pub fn notes_tagged_js(notes: JsValue, tags: JsValue) -> Result<JsValue, JsValue> {
    let notes: Vec<TaggedNote> = serde_wasm_bindgen::from_value(notes)?;
    let tags: Vec<String> = serde_wasm_bindgen::from_value(tags)?;
    Ok(to_js(&graph_tags::notes_tagged(&notes, &tags))?)
}
