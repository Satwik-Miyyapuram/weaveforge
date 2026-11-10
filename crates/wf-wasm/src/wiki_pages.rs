//! Wiki build rules for JavaScript (wf-core `ai::wiki_pages`). The TS wrappers in
//! `packages/wf-wasm/src/wiki-pages.ts` apply the types.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsError, JsValue};
use wf_core::ai::wiki_pages::{
    WikiNote, WikiPaper, find_wiki_root, missing_page_plans, recently_approved_wiki_pages,
    wiki_page_refs, wiki_source_documents,
};

use super::to_js;

fn parse<T: DeserializeOwned>(value: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(value).map_err(|error| JsError::new(&error.to_string()))
}

/// [`find_wiki_root`]: the note titled `Wiki`, or nothing.
#[wasm_bindgen(js_name = findWikiRoot)]
pub fn find_wiki_root_js(pages: JsValue) -> Result<JsValue, JsError> {
    let pages: Vec<WikiNote> = parse(pages)?;
    to_js(&find_wiki_root(&pages)).map_err(|error| JsError::new(&error.to_string()))
}

/// [`wiki_page_refs`]: the wiki's pages as `{ id, title, body }`.
#[wasm_bindgen(js_name = wikiPageRefs)]
pub fn wiki_page_refs_js(pages: JsValue) -> Result<JsValue, JsError> {
    let pages: Vec<WikiNote> = parse(pages)?;
    to_js(&wiki_page_refs(&pages)).map_err(|error| JsError::new(&error.to_string()))
}

/// [`wiki_source_documents`]: notes and papers as extraction documents. `sourceIds` is
/// optional; omitted means every note and paper.
#[wasm_bindgen(js_name = wikiSourceDocuments)]
pub fn wiki_source_documents_js(
    pages: JsValue,
    papers: JsValue,
    source_ids: JsValue,
) -> Result<JsValue, JsError> {
    let pages: Vec<WikiNote> = parse(pages)?;
    let papers: Vec<WikiPaper> = parse(papers)?;
    let source_ids: Option<Vec<String>> = parse(source_ids)?;
    let documents = wiki_source_documents(&pages, &papers, source_ids.as_deref());
    to_js(&documents).map_err(|error| JsError::new(&error.to_string()))
}

/// [`missing_page_plans`]: one placeholder plan per distinct, non-blank dead-link target.
#[wasm_bindgen(js_name = missingPagePlans)]
pub fn missing_page_plans_js(targets: JsValue) -> Result<JsValue, JsError> {
    let targets: Vec<String> = parse(targets)?;
    to_js(&missing_page_plans(&targets)).map_err(|error| JsError::new(&error.to_string()))
}

/// [`recently_approved_wiki_pages`]: the wiki's pages, newest first, capped at `limit`.
#[wasm_bindgen(js_name = recentlyApprovedWikiPages)]
pub fn recently_approved_wiki_pages_js(pages: JsValue, limit: u32) -> Result<JsValue, JsError> {
    let pages: Vec<WikiNote> = parse(pages)?;
    let recent = recently_approved_wiki_pages(&pages, limit as usize);
    to_js(&recent).map_err(|error| JsError::new(&error.to_string()))
}
