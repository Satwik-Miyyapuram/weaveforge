//! Hit collapsing and related-list de-duplication for JavaScript (wf-core
//! `result_dedupe`). The callbacks stay with the caller: `entityDoc` and
//! `resolve` look up records, and only their results reach the core. Merges
//! are replayed in order and the caller's own records come back.

use js_sys::{Array, Function};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::search::result_dedupe::{self, CollapseHit, DistinctInput, RelatedEntry, ResolvedDoc};

use super::to_js;

/// The generic signature wasm-bindgen cannot spell: the caller's records come back.
#[wasm_bindgen(typescript_custom_section)]
const DISTINCT_RELATED_TS: &str = r#"
/**
 * Drop the entries of a related list that name something already listed: the
 * same entity, or the same title within the same kind, or a cut-off copy of a
 * listed title. The first (best-ranked) entry wins, so order is kept. `merge` is
 * told about each entry it absorbed. The records themselves are left alone.
 */
export function distinctRelated<T extends { id: string }>(
  results: readonly T[],
  resolve: (id: string) => { kind: string; entityId: string; title: string } | null,
  limit?: number,
  seedId?: string,
  merge?: (kept: T, dropped: T) => void,
): T[];
"#;

/// A search hit as the caller passes it.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HitIn {
    id: String,
    kind: String,
    entity_id: String,
    score: f64,
}

/// The seed as `collapseToEntities` reads it.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SeedIn {
    entity_id: String,
}

/// [`collapse_hits`](result_dedupe::collapse_hits) as `{id, score}` objects. A PDF page is
/// stood in for by its paper's own document when `entityDoc` finds one; `entityDoc` runs
/// only for non-seed PDF hits and defaults to finding none. The seed's entity is dropped.
///
/// # Errors
///
/// Fails if a hit or the seed has the wrong shape, or `entityDoc` throws.
#[wasm_bindgen(
    js_name = collapseToEntities,
    unchecked_return_type = "{ id: string; score: number }[]"
)]
pub fn collapse_hits_js(
    #[wasm_bindgen(
        unchecked_param_type = "readonly { id: string; kind: string; entityId: string; score: number }[]"
    )]
    hits: &Array,
    #[wasm_bindgen(unchecked_param_type = "{ entityId: string }")] seed: JsValue,
    #[wasm_bindgen(
        unchecked_optional_param_type = "(hit: { id: string; kind: string; entityId: string; score: number }) => string | null"
    )]
    entity_doc: Option<Function>,
) -> Result<JsValue, JsValue> {
    let seed: SeedIn = serde_wasm_bindgen::from_value(seed)?;
    let mut collapse = Vec::with_capacity(hits.length() as usize);
    for raw in hits.iter() {
        let hit: HitIn = serde_wasm_bindgen::from_value(raw.clone())?;
        let is_pdf = hit.kind == "pdf";
        let entity_doc = match &entity_doc {
            Some(find) if is_pdf && hit.entity_id != seed.entity_id => {
                find.call1(&JsValue::UNDEFINED, &raw)?.as_string()
            }
            _ => None,
        };
        collapse.push(CollapseHit {
            id: hit.id,
            entity_id: hit.entity_id,
            score: hit.score,
            is_pdf,
            entity_doc,
        });
    }
    Ok(to_js(&result_dedupe::collapse_hits(
        &collapse,
        &seed.entity_id,
    ))?)
}

/// What `resolve` found for an id: `None` for `null`, `undefined` or another falsy value.
fn resolved(resolve: &Function, id: &str) -> Result<Option<ResolvedDoc>, JsValue> {
    let doc = resolve.call1(&JsValue::UNDEFINED, &JsValue::from_str(id))?;
    if doc.is_falsy() {
        return Ok(None);
    }
    Ok(Some(serde_wasm_bindgen::from_value(doc)?))
}

/// [`distinct_related`](result_dedupe::distinct_related) over the caller's records. The seed
/// (when `seedId` is non-empty) and each entry are resolved in that order; `merge` is told about
/// each absorbed entry, then the kept records come back in order. `limit` defaults to no limit.
///
/// # Errors
///
/// Fails if a record has no string `id`, `resolve` returns a malformed document, `limit` is
/// not a whole number, or a callback throws.
#[wasm_bindgen(js_name = distinctRelated, skip_typescript)]
pub fn distinct_related_js(
    results: &Array,
    resolve: &Function,
    limit: Option<f64>,
    seed_id: Option<String>,
    merge: Option<Function>,
) -> Result<JsValue, JsValue> {
    let records: Vec<JsValue> = results.iter().collect();
    let seed = match seed_id.as_deref() {
        Some(id) if !id.is_empty() => resolved(resolve, id)?,
        _ => None,
    };
    let mut entries = Vec::with_capacity(records.len());
    for record in &records {
        let id = js_sys::Reflect::get(record, &JsValue::from_str("id"))?
            .as_string()
            .unwrap_or_default();
        let doc = resolved(resolve, &id)?;
        entries.push(RelatedEntry { id, doc });
    }
    let limit = match limit {
        Some(limit) if limit.is_finite() => {
            Some(serde_wasm_bindgen::from_value(JsValue::from_f64(limit))?)
        }
        _ => None,
    };
    let out = result_dedupe::distinct_related(&DistinctInput {
        entries,
        seed,
        limit,
    });
    let at = |index: usize| records.get(index).cloned().unwrap_or(JsValue::UNDEFINED);
    if let Some(merge) = &merge {
        for pair in &out.merges {
            let _ = merge.call2(&JsValue::UNDEFINED, &at(pair.owner), &at(pair.dropped))?;
        }
    }
    Ok(out
        .kept
        .iter()
        .map(|&index| at(index))
        .collect::<Array>()
        .into())
}
