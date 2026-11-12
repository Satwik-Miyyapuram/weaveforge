//! Stored documents behind the MiniSearch index for JavaScript (wf-core
//! `search::minisearch_doc`). The JS names match
//! `apps/web/src/features/search/infrastructure/minisearch-index.ts`, which keeps MiniSearch.

#![allow(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen takes arguments by value"
)]

use js_sys::{Array, JsString, Object, Reflect};
use serde::Serialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::excerpt::Excerpt;
use wf_core::search::minisearch_doc::{Candidate, DocRecord, DocStore, SearchHit};
use wf_core::search::query::{ParsedQuery, SearchKind};
use wf_core::search::search_settings;

use super::to_js;

fn encode<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    to_js(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn read<T: serde::de::DeserializeOwned>(raw: JsValue) -> Result<T, JsValue> {
    serde_wasm_bindgen::from_value(raw).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn width_from(limit: u32) -> usize {
    usize::try_from(limit).unwrap_or(usize::MAX)
}

/// Settings as `normalize_search_settings` reads them; `undefined` reads as no settings.
fn settings_from(raw: JsValue) -> Result<Option<search_settings::SearchSettings>, JsValue> {
    let value: serde_json::Value = if raw.is_undefined() {
        serde_json::Value::Null
    } else {
        read(raw)?
    };
    Ok(search_settings::normalize_search_settings(&value))
}

/// The excerpt with its text as UTF-16 units, so a lone surrogate survives (chunks keep each
/// `String.fromCharCode` call under the argument limit).
fn excerpt_to_js(excerpt: &Excerpt) -> Result<JsValue, JsValue> {
    let mut text = JsString::from("");
    for chunk in excerpt.text.chunks(8192) {
        text = text.concat(&JsString::from_char_code(chunk));
    }
    let out = Object::new();
    let _ = Reflect::set(&out, &JsValue::from_str("text"), &text)?;
    let _ = Reflect::set(
        &out,
        &JsValue::from_str("highlights"),
        &encode(&excerpt.highlights)?,
    )?;
    Ok(out.into())
}

fn hits_to_js(hits: &[SearchHit]) -> Result<JsValue, JsValue> {
    let out = Array::new();
    for hit in hits {
        let value = encode(hit)?;
        if let Some(excerpt) = &hit.excerpt {
            let _ = Reflect::set(
                &value,
                &JsValue::from_str("excerpt"),
                &excerpt_to_js(excerpt)?,
            )?;
        }
        let _ = out.push(&value);
    }
    Ok(out.into())
}

/// The stored documents of one MiniSearch index, with filters, document boosts and hit mapping.
#[wasm_bindgen]
#[derive(Default)]
pub struct MiniSearchDocs {
    inner: DocStore,
}

#[wasm_bindgen]
impl MiniSearchDocs {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Ranking settings from the TS `SearchSettings`, normalized as before.
    ///
    /// # Errors
    ///
    /// Fails if `settings` cannot be read as JSON.
    #[wasm_bindgen(js_name = setSettings)]
    pub fn set_settings(&mut self, settings: JsValue) -> Result<(), JsValue> {
        self.inner.set_settings(settings_from(settings)?);
        Ok(())
    }

    /// Insert or replace each record, in array order.
    ///
    /// # Errors
    ///
    /// Fails when `records` is not an array of stored documents.
    pub fn put(&mut self, records: JsValue) -> Result<(), JsValue> {
        let records: Vec<DocRecord> = read(records)?;
        for record in records {
            self.inner.put(record);
        }
        Ok(())
    }

    /// Remove by id; unknown ids are ignored.
    pub fn remove(&mut self, id: &str) {
        self.inner.remove(id);
    }

    /// Whether a document with this id is held.
    #[must_use]
    pub fn has(&self, id: &str) -> bool {
        self.inner.has(id)
    }

    pub fn clear(&mut self) {
        self.inner.clear();
    }

    /// Ids of the documents whose kind is one of `kinds`, in insertion order.
    ///
    /// # Errors
    ///
    /// Fails when `kinds` is not an array of kind names.
    #[wasm_bindgen(js_name = idsOfKind)]
    pub fn ids_of_kind(&self, kinds: JsValue) -> Result<JsValue, JsValue> {
        let kinds: Vec<SearchKind> = read(kinds)?;
        encode(&self.inner.ids_of_kind(&kinds))
    }

    /// The hit for one document, or `null` when it is not held.
    ///
    /// # Errors
    ///
    /// Fails only if the hit cannot be encoded.
    #[wasm_bindgen(js_name = hitById)]
    pub fn hit_by_id(&self, id: &str) -> Result<JsValue, JsValue> {
        match self.inner.hit_by_id(id) {
            Some(hit) => encode(&hit),
            None => Ok(JsValue::NULL),
        }
    }

    /// Every `[id, document]` pair in insertion order, as persisted.
    ///
    /// # Errors
    ///
    /// Fails only if the documents cannot be encoded.
    pub fn entries(&self) -> Result<JsValue, JsValue> {
        encode(&self.inner.entries())
    }

    /// The document boost for MiniSearch's `boostDocument`; `1` for an unknown id.
    #[wasm_bindgen(js_name = boostOf)]
    #[must_use]
    pub fn boost_of(&self, id: &str, now: f64) -> f64 {
        self.inner.boost_of(id, now)
    }

    /// Every document's boost in one call: `{ ids, boosts }` as parallel arrays.
    ///
    /// # Errors
    ///
    /// Fails only if the table cannot be encoded.
    pub fn boosts(&self, now: f64) -> Result<JsValue, JsValue> {
        #[derive(Serialize)]
        struct Table {
            ids: Vec<String>,
            boosts: Vec<f64>,
        }
        let (ids, boosts) = self.inner.boosts(now);
        encode(&Table { ids, boosts })
    }

    /// Filter-only hits, best first, up to `limit`. `kinds` is the caller's kind list or `null`.
    ///
    /// # Errors
    ///
    /// Fails when `query` or `kinds` cannot be read.
    #[wasm_bindgen(js_name = filterOnly)]
    pub fn filter_only(
        &self,
        query: JsValue,
        kinds: JsValue,
        limit: u32,
        now: f64,
    ) -> Result<JsValue, JsValue> {
        let query: ParsedQuery = read(query)?;
        let kinds: Option<Vec<SearchKind>> = read(kinds)?;
        let hits = self
            .inner
            .filter_only(&query, kinds.as_deref(), width_from(limit), now);
        hits_to_js(&hits)
    }

    /// Ranked hits from MiniSearch `candidates` that pass the filters, up to `limit`. Returns
    /// an empty array when nothing passes, which is the TS retry signal.
    ///
    /// # Errors
    ///
    /// Fails when an argument cannot be read, or when a hit's terms exceed the excerpt cap.
    pub fn finish(
        &self,
        candidates: JsValue,
        query: JsValue,
        kinds: JsValue,
        limit: u32,
        now: f64,
        excerpts: bool,
    ) -> Result<JsValue, JsValue> {
        let candidates: Vec<Candidate> = read(candidates)?;
        let query: ParsedQuery = read(query)?;
        let kinds: Option<Vec<SearchKind>> = read(kinds)?;
        let excerpt_units = excerpts.then(crate::max_index_text_utf16);
        let hits = self
            .inner
            .finish(
                &candidates,
                &query,
                kinds.as_deref(),
                width_from(limit),
                now,
                excerpt_units,
            )
            .map_err(|error| JsValue::from_str(&error))?;
        hits_to_js(&hits)
    }
}
