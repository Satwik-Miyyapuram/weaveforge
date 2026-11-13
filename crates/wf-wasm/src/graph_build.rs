//! Citation-graph builder for JavaScript (wf-core `relations::graph_build`). The JS
//! name and signature match `apps/web/src/features/relations/application/build-graph-data.ts`;
//! list membership comes in as a `Map` of `Set`s and the lookups go out as `Map`s.

use std::collections::HashMap;

use js_sys::{Array, Map, Object, Reflect, Set};
use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::relations::graph_build::{self, GraphBuildInput};

use super::to_js;

/// The items of an optional array argument; `undefined` is empty.
fn items<T: DeserializeOwned>(value: Option<JsValue>) -> Result<Vec<T>, serde_wasm_bindgen::Error> {
    value.map_or_else(|| Ok(Vec::new()), serde_wasm_bindgen::from_value)
}

/// List id to member ids, from a `Map` of `Set`s; `undefined` is empty.
fn membership_of(
    membership: Option<JsValue>,
) -> Result<HashMap<String, Vec<String>>, serde_wasm_bindgen::Error> {
    let Some(membership) = membership else {
        return Ok(HashMap::new());
    };
    Array::from(&membership)
        .iter()
        .map(|entry| {
            let entry: Array = entry.unchecked_into();
            let id: String = serde_wasm_bindgen::from_value(entry.get(0))?;
            let ids: Vec<String> =
                serde_wasm_bindgen::from_value(Array::from(&entry.get(1)).into())?;
            Ok((id, ids))
        })
        .collect()
}

/// `record[key]` as a `Map` in `Object.entries` order, each value wrapped in a `Set` when `as_sets`.
fn map_of(record: &JsValue, key: &str, as_sets: bool) -> Result<Map, JsValue> {
    let record: Object = Reflect::get(record, &JsValue::from_str(key))?.unchecked_into();
    let out = Map::new();
    for entry in Object::entries(&record).iter() {
        let entry: Array = entry.unchecked_into();
        let value = entry.get(1);
        let value = if as_sets {
            Set::new(&value).into()
        } else {
            value
        };
        let _ = out.set(&entry.get(0), &value);
    }
    Ok(out)
}

/// [`build_graph_data`](graph_build::build_graph_data): nodes, links and lookups for one graph view.
/// `membership` is list id to member ids; it and the trailing arrays default to empty.
///
/// # Errors
///
/// Fails if an argument has the wrong shape, or the result cannot be serialised.
#[wasm_bindgen(
    js_name = buildGraphData,
    unchecked_return_type = "{ data: { nodes: (B.GraphNode & { x?: number; y?: number; fx?: number; fy?: number })[]; links: B.GraphLink[] }; neighbors: Map<string, Set<string>>; tagToPapers: Map<string, string[]>; tagToNotes: Map<string, string[]> }"
)]
#[allow(clippy::too_many_arguments)] // The caller's positional signature.
pub fn build_graph_data_js(
    #[wasm_bindgen(unchecked_param_type = "B.GraphBuildPaper[]")] papers: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.PaperRelation[]")] relations: JsValue,
    #[wasm_bindgen(unchecked_param_type = "B.GraphViewSettings")] settings: JsValue,
    #[wasm_bindgen(unchecked_optional_param_type = "ReadonlyMap<string, ReadonlySet<string>>")]
    membership: Option<JsValue>,
    #[wasm_bindgen(unchecked_optional_param_type = "B.GraphBuildList[]")] lists: Option<JsValue>,
    #[wasm_bindgen(unchecked_optional_param_type = "B.GraphBuildNote[]")] notes: Option<JsValue>,
    #[wasm_bindgen(unchecked_optional_param_type = "B.GraphBuildSection[]")] sections: Option<
        JsValue,
    >,
    #[wasm_bindgen(unchecked_optional_param_type = "B.GraphBuildExperiment[]")] experiments: Option<
        JsValue,
    >,
) -> Result<JsValue, JsValue> {
    let input = GraphBuildInput {
        papers: serde_wasm_bindgen::from_value(papers)?,
        relations: serde_wasm_bindgen::from_value(relations)?,
        settings: serde_wasm_bindgen::from_value(settings)?,
        membership: membership_of(membership)?,
        lists: items(lists)?,
        notes: items(notes)?,
        sections: items(sections)?,
        experiments: items(experiments)?,
    };
    let raw = to_js(&graph_build::build_graph_data(&input))?;
    let out = Object::new();
    let _ = Reflect::set(
        &out,
        &JsValue::from_str("data"),
        &Reflect::get(&raw, &JsValue::from_str("data"))?,
    )?;
    let _ = Reflect::set(
        &out,
        &JsValue::from_str("neighbors"),
        &map_of(&raw, "neighbors", true)?.into(),
    )?;
    let _ = Reflect::set(
        &out,
        &JsValue::from_str("tagToPapers"),
        &map_of(&raw, "tagToPapers", false)?.into(),
    )?;
    let _ = Reflect::set(
        &out,
        &JsValue::from_str("tagToNotes"),
        &map_of(&raw, "tagToNotes", false)?.into(),
    )?;
    Ok(out.into())
}
