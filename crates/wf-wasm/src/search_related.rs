//! Related-document helpers for JavaScript (wf-core `search::related`). The JS names match
//! `packages/core/src/search/parts.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::personalized_pagerank::RelatedNode;
use wf_core::search::related::{self, RelatedArm};
use wf_core::search::wiki_graph::WikiGraph;

use super::personalized_pagerank::{RngFn, options_from, rng_from};
use super::to_js;

#[wasm_bindgen]
extern "C" {
    /// A JS `(seedId: string, limit: number) => { id: string; score: number }[]`, the lexical or
    /// tag arm of `findRelated`.
    #[wasm_bindgen(
        typescript_type = "(seedId: string, limit: number) => { id: string; score: number }[]"
    )]
    pub type ArmFn;

    #[wasm_bindgen(method, js_name = call)]
    fn call_arm(this: &ArmFn, this_arg: &JsValue, seed: &str, limit: u32) -> JsValue;
}

/// Run a JS arm and read its hits. A value that is not a hit list reads as no hits.
fn arm_hits(arm: &ArmFn, seed: &str, limit: usize) -> Vec<RelatedNode> {
    let limit = u32::try_from(limit).unwrap_or(u32::MAX);
    serde_wasm_bindgen::from_value(arm.call_arm(&JsValue::UNDEFINED, seed, limit))
        .unwrap_or_default()
}

/// [`find_related`](related::find_related); `[{ id, score, arm, arms?, similarity? }]`, best first.
///
/// # Errors
///
/// Fails if `graph` or `options` has the wrong shape.
#[wasm_bindgen(js_name = findRelated)]
pub fn find_related_js(
    graph: JsValue,
    seed: &str,
    limit: u32,
    options: JsValue,
    rng: &RngFn,
    lexical: &ArmFn,
    tagged: &ArmFn,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let graph: WikiGraph = serde_wasm_bindgen::from_value(graph)?;
    let options = options_from(options)?;
    let mut rng = rng_from(rng);
    let limit = usize::try_from(limit).unwrap_or(usize::MAX);
    let found = related::find_related(
        seed,
        &graph,
        limit,
        &options,
        &mut rng,
        |id, max| arm_hits(lexical, id, max),
        |id, max| arm_hits(tagged, id, max),
    );
    to_js(&found)
}

/// [`explain_arm`](related::explain_arm).
///
/// # Errors
///
/// Fails if `arm` is not a known arm name.
#[wasm_bindgen(js_name = explainArm)]
pub fn explain_arm_js(
    #[wasm_bindgen(unchecked_param_type = "B.RelatedArm")] arm: JsValue,
) -> Result<String, serde_wasm_bindgen::Error> {
    let arm: RelatedArm = serde_wasm_bindgen::from_value(arm)?;
    Ok(related::explain_arm(arm).to_owned())
}
