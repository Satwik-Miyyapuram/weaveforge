//! Personalized PageRank for JavaScript (wf-core `personalized_pagerank`). The JS names match
//! `packages/core/src/search/personalized-pagerank.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::personalized_pagerank::{self, NodeScore, PprOptions, RelatedNode};
use wf_core::search::wiki_graph::WikiGraph;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

#[wasm_bindgen]
extern "C" {
    /// A JS `() => number`, the injected `rng`.
    #[wasm_bindgen(typescript_type = "() => number")]
    pub type RngFn;

    #[wasm_bindgen(method, js_name = call)]
    fn call_with_this(this: &RngFn, this_arg: &JsValue) -> JsValue;
}

/// Options as JSON; `undefined` and `null` mean the defaults.
fn options_from(raw: JsValue) -> JsResult<PprOptions> {
    if raw.is_undefined() || raw.is_null() {
        return Ok(PprOptions::default());
    }
    serde_wasm_bindgen::from_value(raw)
}

/// The JS `rng` as a Rust closure. A non-numeric result reads as NaN, which teleports.
fn rng_from(rng: &RngFn) -> impl FnMut() -> f64 + '_ {
    move || {
        rng.call_with_this(&JsValue::UNDEFINED)
            .as_f64()
            .unwrap_or(f64::NAN)
    }
}

/// [`personalized_page_rank`](personalized_pagerank::personalized_page_rank); `[{ node, score }]`
/// in first-visit order.
///
/// # Errors
///
/// Fails if `graph` or `options` has the wrong shape.
#[wasm_bindgen(js_name = personalizedPageRank)]
pub fn personalized_page_rank_js(
    graph: JsValue,
    seed: &str,
    options: JsValue,
    rng: &RngFn,
) -> JsResult<JsValue> {
    let graph: WikiGraph = serde_wasm_bindgen::from_value(graph)?;
    let options = options_from(options)?;
    let mut rng = rng_from(rng);
    let scores: Vec<NodeScore> =
        personalized_pagerank::personalized_page_rank(&graph, seed, &options, &mut rng);
    to_js(&scores)
}

/// [`related_by_ppr`](personalized_pagerank::related_by_ppr); `[{ id, score }]`, best first.
///
/// # Errors
///
/// Fails if `graph` or `options` has the wrong shape.
#[wasm_bindgen(js_name = relatedByPpr)]
pub fn related_by_ppr_js(
    graph: JsValue,
    seed: &str,
    limit: u32,
    options: JsValue,
    rng: &RngFn,
) -> JsResult<JsValue> {
    let graph: WikiGraph = serde_wasm_bindgen::from_value(graph)?;
    let options = options_from(options)?;
    let mut rng = rng_from(rng);
    let limit = usize::try_from(limit).unwrap_or(usize::MAX);
    let related: Vec<RelatedNode> =
        personalized_pagerank::related_by_ppr(&graph, seed, limit, &options, &mut rng);
    to_js(&related)
}
