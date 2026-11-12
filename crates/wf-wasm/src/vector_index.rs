//! `VectorIndex` for JavaScript (wf-core `search::vector_index`). The JS names match
//! `packages/wf-wasm/src/vector-index.ts`, which adds the typed wrappers.

#![allow(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen takes arguments by value"
)]

use serde::Serialize;
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::semantic_hits;
use wf_core::search::vector_index::{VectorError, VectorIndex as Core};

/// Errors cross the boundary as their message; the TS wrapper rethrows them.
fn js_error(error: &VectorError) -> JsValue {
    JsValue::from_str(&error.to_string())
}

fn encode<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    super::to_js(value).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn ids_from(raw: JsValue) -> Result<Vec<String>, JsValue> {
    serde_wasm_bindgen::from_value(raw).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn width_from(dimensions: u32) -> usize {
    usize::try_from(dimensions).unwrap_or(usize::MAX)
}

/// Brute-force cosine index over normalized vectors.
#[wasm_bindgen]
pub struct VectorIndex {
    inner: Core,
}

#[wasm_bindgen]
impl VectorIndex {
    /// The width every vector must have.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn dimensions(&self) -> u32 {
        u32::try_from(self.inner.dimensions()).unwrap_or(u32::MAX)
    }

    /// How many vectors are held.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn size(&self) -> u32 {
        u32::try_from(self.inner.size()).unwrap_or(u32::MAX)
    }

    /// Whether `id` is held.
    #[must_use]
    pub fn has(&self, id: &str) -> bool {
        self.inner.has(id)
    }

    /// The stored unit vector for `id`; empty when absent (dimensions are at least 1).
    #[wasm_bindgen(js_name = vectorOf)]
    #[must_use]
    pub fn vector_of(&self, id: &str) -> Vec<f32> {
        self.inner.vector_of(id).unwrap_or_default()
    }

    /// Every id held, in slot order.
    #[wasm_bindgen(js_name = allIds, unchecked_return_type = "string[]")]
    pub fn all_ids(&self) -> Result<JsValue, JsValue> {
        encode(&self.inner.all_ids())
    }

    /// Insert or replace; `values` is `ids.length * dimensions` long and is all-or-nothing.
    ///
    /// # Errors
    ///
    /// Fails when `ids` is not a string array or `values` has the wrong length.
    pub fn add(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "string[]")] ids: JsValue,
        values: Vec<f32>,
    ) -> Result<(), JsValue> {
        let ids = ids_from(ids)?;
        self.inner
            .add(&ids, &values)
            .map_err(|error| js_error(&error))
    }

    /// Remove by id; unknown ids are ignored.
    ///
    /// # Errors
    ///
    /// Fails when `ids` is not a string array.
    pub fn remove(
        &mut self,
        #[wasm_bindgen(unchecked_param_type = "string[]")] ids: JsValue,
    ) -> Result<(), JsValue> {
        let ids = ids_from(ids)?;
        self.inner.remove(&ids);
        Ok(())
    }

    /// Drop every vector.
    pub fn clear(&mut self) {
        self.inner.clear();
    }

    /// Top `limit` by cosine similarity, best first; scores below `minScore` are dropped.
    ///
    /// # Errors
    ///
    /// Fails when `query` is not the index width.
    #[wasm_bindgen(unchecked_return_type = "{ id: string; score: number }[]")]
    pub fn search(&self, query: Vec<f32>, limit: u32, min_score: f64) -> Result<JsValue, JsValue> {
        let hits = self
            .inner
            .search(&query, width_from(limit), min_score)
            .map_err(|error| js_error(&error))?;
        encode(&hits)
    }

    /// The packed bytes; read back with `vectorIndexFromBytes`.
    #[wasm_bindgen(js_name = toBytes)]
    #[must_use]
    pub fn to_bytes(&self) -> Vec<u8> {
        self.inner.to_bytes()
    }

    /// Nearest documents to `query`, one hit per document (wf-core `semantic_hits::search_docs`).
    ///
    /// # Errors
    ///
    /// Fails when `query` is not the index width.
    #[wasm_bindgen(js_name = searchDocs, unchecked_return_type = "{ id: string; score: number }[]")]
    pub fn search_docs(&self, query: Vec<f32>, limit: u32) -> Result<JsValue, JsValue> {
        let hits = semantic_hits::search_docs(&self.inner, &query, width_from(limit))
            .map_err(|error| js_error(&error))?;
        encode(&hits)
    }

    /// Documents nearest to one already indexed, from its own passages (wf-core `semantic_hits::nearest_docs`).
    ///
    /// # Errors
    ///
    /// Fails when a stored passage is not the index width.
    #[wasm_bindgen(js_name = nearestDocs, unchecked_return_type = "{ id: string; score: number }[]")]
    pub fn nearest_docs(&self, doc_id: &str, limit: u32) -> Result<JsValue, JsValue> {
        let hits = semantic_hits::nearest_docs(&self.inner, doc_id, width_from(limit))
            .map_err(|error| js_error(&error))?;
        encode(&hits)
    }
}

/// An empty index `dimensions` wide.
///
/// # Errors
///
/// Fails when `dimensions` is zero.
#[wasm_bindgen(js_name = createVectorIndex)]
pub fn create_vector_index(dimensions: u32) -> Result<VectorIndex, JsValue> {
    Core::new(width_from(dimensions))
        .map(|inner| VectorIndex { inner })
        .map_err(|error| js_error(&error))
}

/// Rebuild an index from `VectorIndex.toBytes()` output.
///
/// # Errors
///
/// Fails when the bytes are truncated, have trailing data, or repeat an id.
#[wasm_bindgen(js_name = vectorIndexFromBytes)]
pub fn vector_index_from_bytes(bytes: Vec<u8>) -> Result<VectorIndex, JsValue> {
    Core::from_bytes(&bytes)
        .map(|inner| VectorIndex { inner })
        .map_err(|error| js_error(&error))
}
