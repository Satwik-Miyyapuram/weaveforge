//! Personalized PageRank for JavaScript (wf-core `personalized_pagerank`). The JS names match
//! `packages/core/src/search/personalized-pagerank.ts`.

use js_sys::{Function, Map, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::search::personalized_pagerank::{self, NodeScore, PprOptions, RelatedNode};

use super::to_js;
use super::wiki_graph::graph_from_js;

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
pub(crate) fn options_from(raw: JsValue) -> JsResult<PprOptions> {
    if raw.is_undefined() || raw.is_null() {
        return Ok(PprOptions::default());
    }
    serde_wasm_bindgen::from_value(raw)
}

/// The JS `rng` as a Rust closure. A non-numeric result reads as NaN, which teleports.
pub(crate) fn rng_from(rng: &RngFn) -> impl FnMut() -> f64 + '_ {
    move || {
        rng.call_with_this(&JsValue::UNDEFINED)
            .as_f64()
            .unwrap_or(f64::NAN)
    }
}

/// The `rng` of `options` when it is a function; `None` means `Math.random`.
fn rng_of(options: &JsValue) -> Result<Option<RngFn>, JsValue> {
    if options.is_undefined() || options.is_null() {
        return Ok(None);
    }
    Ok(Reflect::get(options, &JsValue::from_str("rng"))?
        .dyn_into::<Function>()
        .ok()
        .map(JsCast::unchecked_into))
}

/// [`personalized_page_rank`](personalized_pagerank::personalized_page_rank): a `Map` from node
/// to visit probability, in first-visit order. `options.rng` defaults to `Math.random`.
///
/// # Errors
///
/// Fails if `graph` or `options` has the wrong shape.
#[wasm_bindgen(js_name = personalizedPageRank, unchecked_return_type = "Map<string, number>")]
pub fn personalized_page_rank_js(
    #[wasm_bindgen(unchecked_param_type = "{ nodes: string[]; edges: Map<string, string[]> }")]
    graph: JsValue,
    seed: &str,
    #[wasm_bindgen(
        unchecked_optional_param_type = "{ numWalks?: number; maxSteps?: number; damping?: number; rng?: () => number }"
    )]
    options: Option<JsValue>,
) -> Result<JsValue, JsValue> {
    let graph = graph_from_js(&graph)?;
    let options = options.unwrap_or(JsValue::UNDEFINED);
    let rng_fn = rng_of(&options)?;
    let options: PprOptions = options_from(options)?;
    let mut js_rng = rng_fn.as_ref().map(rng_from);
    let mut rng = || js_rng.as_mut().map_or_else(js_sys::Math::random, |f| f());
    let scores: Vec<NodeScore> =
        personalized_pagerank::personalized_page_rank(&graph, seed, &options, &mut rng);
    let out = Map::new();
    for entry in &scores {
        let _ = out.set(
            &JsValue::from_str(&entry.node),
            &JsValue::from_f64(entry.score),
        );
    }
    Ok(out.into())
}

/// JS `Array.prototype.slice(0, limit)` end index for a list of `len` items.
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
fn slice_end(limit: f64, len: usize) -> usize {
    let limit = if limit.is_nan() { 0.0 } else { limit.trunc() };
    let end = if limit < 0.0 {
        (len as f64 + limit).max(0.0)
    } else {
        limit.min(len as f64)
    };
    end as usize
}

/// [`related_by_ppr`](personalized_pagerank::related_by_ppr): the top `limit` neighbours
/// (default 10, with JS `slice` semantics), best first, excluding the seed.
///
/// # Errors
///
/// Fails if `graph` or `options` has the wrong shape.
#[wasm_bindgen(js_name = relatedByPpr, unchecked_return_type = "B.RelatedNode[]")]
pub fn related_by_ppr_js(
    #[wasm_bindgen(unchecked_param_type = "{ nodes: string[]; edges: Map<string, string[]> }")]
    graph: JsValue,
    seed: &str,
    limit: Option<f64>,
    #[wasm_bindgen(
        unchecked_optional_param_type = "{ numWalks?: number; maxSteps?: number; damping?: number; rng?: () => number }"
    )]
    options: Option<JsValue>,
) -> Result<JsValue, JsValue> {
    let graph = graph_from_js(&graph)?;
    let options = options.unwrap_or(JsValue::UNDEFINED);
    let rng_fn = rng_of(&options)?;
    let options: PprOptions = options_from(options)?;
    let mut js_rng = rng_fn.as_ref().map(rng_from);
    let mut rng = || js_rng.as_mut().map_or_else(js_sys::Math::random, |f| f());
    let mut related: Vec<RelatedNode> =
        personalized_pagerank::related_by_ppr(&graph, seed, usize::MAX, &options, &mut rng);
    related.truncate(slice_end(limit.unwrap_or(10.0), related.len()));
    Ok(to_js(&related)?)
}
