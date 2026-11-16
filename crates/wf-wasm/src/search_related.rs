//! Related-document helpers for JavaScript (wf-core `search::related`). The JS names match
//! `packages/core/src/search/parts.ts`.

use std::cell::RefCell;

use js_sys::{Function, Reflect};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::search::personalized_pagerank::{PprOptions, RelatedNode};
use wf_core::search::related::{self, RelatedArm};

use super::to_js;
use super::wiki_graph::graph_from_js;

/// A property of a JS object, `undefined` when it is missing.
fn field(object: &JsValue, key: &str) -> Result<JsValue, JsValue> {
    if object.is_undefined() || object.is_null() {
        return Ok(JsValue::UNDEFINED);
    }
    Reflect::get(object, &JsValue::from_str(key))
}

/// Run a JS arm and read its hits. A missing arm, or a value that is not a hit list, reads as
/// no hits; a throw is kept in `error` and reads as no hits.
fn arm_hits(
    arm: Option<&Function>,
    seed: &str,
    limit: usize,
    error: &RefCell<Option<JsValue>>,
) -> Vec<RelatedNode> {
    let Some(arm) = arm else {
        return Vec::new();
    };
    let limit = u32::try_from(limit).unwrap_or(u32::MAX);
    match arm.call2(
        &JsValue::UNDEFINED,
        &JsValue::from_str(seed),
        &JsValue::from(limit),
    ) {
        Ok(hits) => serde_wasm_bindgen::from_value(hits).unwrap_or_default(),
        Err(thrown) => {
            let _ = error.replace(Some(thrown));
            Vec::new()
        }
    }
}

/// [`find_related`](related::find_related): graph walk first, then the lexical arm, then the tag
/// arm; the first non-empty arm wins and later arms run only when needed. `limit` defaults to 10
/// and `options.rng` to `Math.random`; a missing arm finds nothing.
///
/// # Errors
///
/// Fails if `deps.graph` or `options` has the wrong shape, or an arm or `rng` throws.
#[wasm_bindgen(js_name = findRelated, unchecked_return_type = "B.RelatedResult[]")]
pub fn find_related_js(
    #[wasm_bindgen(js_name = seedId)] seed_id: &str,
    #[wasm_bindgen(
        unchecked_param_type = "{ graph: { nodes: string[]; edges: Map<string, string[]> }; lexical?: (seedId: string, limit: number) => { id: string; score: number }[]; tagged?: (seedId: string, limit: number) => { id: string; score: number }[] }"
    )]
    deps: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "number")] limit: Option<u32>,
    #[wasm_bindgen(
        unchecked_optional_param_type = "{ numWalks?: number; maxSteps?: number; damping?: number; rng?: () => number }"
    )]
    options: Option<JsValue>,
) -> Result<JsValue, JsValue> {
    let options = options
        .filter(|o| !o.is_undefined())
        .unwrap_or_else(|| js_sys::Object::new().into());
    let graph = graph_from_js(&field(&deps, "graph")?)?;
    let lexical = field(&deps, "lexical")?.dyn_into::<Function>().ok();
    let tagged = field(&deps, "tagged")?.dyn_into::<Function>().ok();
    let ppr = PprOptions {
        num_walks: serde_wasm_bindgen::from_value(field(&options, "numWalks")?)?,
        max_steps: serde_wasm_bindgen::from_value(field(&options, "maxSteps")?)?,
        damping: serde_wasm_bindgen::from_value(field(&options, "damping")?)?,
    };
    let rng_fn = field(&options, "rng")?.dyn_into::<Function>().ok();
    let error = RefCell::new(None);
    let mut rng = || match &rng_fn {
        Some(rng) => match rng.call0(&JsValue::UNDEFINED) {
            Ok(value) => value.as_f64().unwrap_or(f64::NAN),
            Err(thrown) => {
                let _ = error.replace(Some(thrown));
                f64::NAN
            }
        },
        None => js_sys::Math::random(),
    };
    let limit = usize::try_from(limit.unwrap_or(10)).unwrap_or(usize::MAX);
    let found = related::find_related(
        seed_id,
        &graph,
        limit,
        &ppr,
        &mut rng,
        |id, max| arm_hits(lexical.as_ref(), id, max, &error),
        |id, max| arm_hits(tagged.as_ref(), id, max, &error),
    );
    if let Some(thrown) = error.take() {
        return Err(thrown);
    }
    Ok(to_js(&found)?)
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
