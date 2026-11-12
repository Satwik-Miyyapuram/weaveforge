//! Reference index for JavaScript (`apps/web/src/features/reader/application/reader-references.ts`).
//! Wraps `wf_core::reader::reader_references`. The flat lists come from the core; the `Map`s the
//! overlay reads (`byIndex`, `mentionsByPage`) are built here.

use js_sys::{Array, Map, Object, Reflect};
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::reader::reader_references::{
    ReaderReferenceIndex, build_reference_index, index_from_analysis, outline_items_for,
};
use wf_core::reader_analysis::document_analysis::DocumentAnalysis;
use wf_core::reader_analysis::outline::OutlineReaderItem;
use wf_core::reader_analysis::types::AnalysisPdfPage;

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// The index types and the generic signatures of [`build_reference_index_js`] and
/// [`index_from_analysis_js`], which carry a generic and `Map`s that wasm-bindgen and specta cannot express.
#[wasm_bindgen(typescript_custom_section)]
const READER_REFERENCES_TS: &str = r#"
/** A clickable thing found in the page text. Shape of the Rust MentionHit, serialised camelCase. */
export interface MentionHit {
  key: string;
  kind: "citation" | "figure" | "url";
  start: number;
  end: number;
  label: string;
  url?: string;
  refIndexes: number[];
  rects?: number[][];
  target?: unknown;
  source?: string;
  confidence?: number;
}

/** One parsed bibliography entry as the core serialises it. Callers pick a richer type through the generic `R`. */
export interface ParsedReferenceEntry {
  index: number;
  raw: string;
}

export interface ReaderReferenceIndex<R extends ParsedReferenceEntry = ParsedReferenceEntry> {
  references: R[];
  byIndex: Map<number, R>;
  mentionsByPage: Map<number, MentionHit[]>;
  bodyFontSize: number;
  fingerprint: string;
}

/** The page shape the core reads: 1-based page number, text items, and `/Link` annotations. */
export interface ReferencePage {
  pageNumber: number;
  items: readonly { str: string; hasEOL?: boolean }[];
  links?: readonly object[];
}

/** Shape a completed analysis (plain arrays from the worker) into the overlay's index. */
export function indexFromAnalysis<R extends ParsedReferenceEntry = ParsedReferenceEntry>(
  analysis: unknown,
  pages: readonly ReferencePage[],
): ReaderReferenceIndex<R>;

/** Analyze the pages and shape the result in one step. */
export function buildReferenceIndex<R extends ParsedReferenceEntry = ParsedReferenceEntry>(
  pages: readonly ReferencePage[],
  outline?: readonly unknown[],
): ReaderReferenceIndex<R>;
"#;

/// Shapes the core's flat index into the overlay's: `references` as an array, `byIndex` mapping each
/// entry's `index` to the same object, and `mentionsByPage` mapping page number to its hits.
fn to_maps(index: &ReaderReferenceIndex) -> JsResult<JsValue> {
    let references: Array = to_js(&index.references)?.into();
    let by_index = Map::new();
    for (reference, value) in index.references.iter().zip(references.iter()) {
        let _ = by_index.set(&JsValue::from_f64(reference.index), &value);
    }
    let mentions_by_page = Map::new();
    for page in &index.mentions_by_page {
        let _ = mentions_by_page.set(
            &JsValue::from_f64(page.page_number),
            &to_js(&page.mentions)?,
        );
    }
    let out = Object::new();
    let set = |key: &str, value: &JsValue| {
        Reflect::set(&out, &JsValue::from_str(key), value)
            .map(|_| ())
            .map_err(|_| serde_wasm_bindgen::Error::new(format!("cannot set {key}")))
    };
    set("references", &references)?;
    set("byIndex", &by_index)?;
    set("mentionsByPage", &mentions_by_page)?;
    set("bodyFontSize", &JsValue::from_f64(index.body_font_size))?;
    set("fingerprint", &JsValue::from_str(&index.fingerprint))?;
    Ok(out.into())
}

/// [`build_reference_index`]: analyzes the pages and shapes the overlay's index in one step.
/// `outline` defaults to none.
///
/// # Errors
///
/// Fails if `pages` or `outline` do not have the expected shape.
#[wasm_bindgen(js_name = buildReferenceIndex, skip_typescript)]
pub fn build_reference_index_js(pages: JsValue, outline: Option<JsValue>) -> JsResult<JsValue> {
    let pages: Vec<AnalysisPdfPage> = serde_wasm_bindgen::from_value(pages)?;
    let outline: Vec<OutlineReaderItem> = match outline {
        Some(value) if !value.is_undefined() && !value.is_null() => {
            serde_wasm_bindgen::from_value(value)?
        }
        _ => Vec::new(),
    };
    to_maps(&build_reference_index(&pages, &outline))
}

/// [`index_from_analysis`]: shapes a completed analysis (plain arrays from the worker) into the
/// overlay's index.
///
/// # Errors
///
/// Fails if `analysis` or `pages` do not have the expected shape.
#[wasm_bindgen(js_name = indexFromAnalysis, skip_typescript)]
pub fn index_from_analysis_js(analysis: JsValue, pages: JsValue) -> JsResult<JsValue> {
    let analysis: DocumentAnalysis = serde_wasm_bindgen::from_value(analysis)?;
    let pages: Vec<AnalysisPdfPage> = serde_wasm_bindgen::from_value(pages)?;
    to_maps(&index_from_analysis(&analysis, &pages))
}

/// [`outline_items_for`]: the pages' runs as outline items, one array per page.
///
/// # Errors
///
/// Fails if `pages` does not have the expected shape.
#[wasm_bindgen(js_name = outlineItemsFor, unchecked_return_type = "unknown[][]")]
pub fn outline_items_for_js(
    #[wasm_bindgen(unchecked_param_type = "readonly ReferencePage[]")] pages: JsValue,
) -> JsResult<JsValue> {
    let pages: Vec<AnalysisPdfPage> = serde_wasm_bindgen::from_value(pages)?;
    to_js(&outline_items_for(&pages))
}
