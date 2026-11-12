//! Outline-from-text helpers (Rust `reader_analysis::outline`). Each export wraps
//! one function; the JS names and shapes match
//! `packages/core/src/features/reader/outline-from-text.ts`.
//!
//! Objects cross as plain JS objects through serde; numbers cross as f64.
//! `isRotatedText` takes a `Float64Array`. The exports apply the defaults.

use js_sys::{Array, Function, Object, Reflect, Set};
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::reader_analysis::outline as analysis_outline;
use wf_core::reader_analysis::outline::{OutlinePageRef, OutlineTextItem};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`is_rotated_text`](analysis_outline::is_rotated_text) (TS `isRotatedText`).
#[wasm_bindgen(js_name = isRotatedText)]
#[must_use]
pub fn is_rotated_text_js(
    #[wasm_bindgen(unchecked_param_type = "readonly number[]")] transform: &[f64],
) -> bool {
    analysis_outline::is_rotated_text(transform)
}

/// [`outline_text_lines`](analysis_outline::outline_text_lines) (TS `outlineTextLines`).
///
/// # Errors
///
/// Fails if `pages` is not an array of arrays of text items.
#[wasm_bindgen(js_name = outlineTextLines, unchecked_return_type = "B.OutlineTextItem[]")]
pub fn outline_text_lines_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly B.OutlineTextItem[])[]")]
    pages: JsValue,
) -> JsResult<JsValue> {
    let pages: Vec<Vec<OutlineTextItem>> = serde_wasm_bindgen::from_value(pages)?;
    to_js(&analysis_outline::outline_text_lines(&pages))
}

/// [`body_font_size`](analysis_outline::body_font_size) (TS `bodyFontSize`).
///
/// # Errors
///
/// Fails if `pages` is not an array of arrays of text items.
#[wasm_bindgen(js_name = bodyFontSize)]
pub fn body_font_size_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly B.OutlineTextItem[])[]")]
    pages: JsValue,
) -> JsResult<f64> {
    let pages: Vec<Vec<OutlineTextItem>> = serde_wasm_bindgen::from_value(pages)?;
    Ok(analysis_outline::body_font_size(&pages))
}

/// [`levenshtein`](analysis_outline::levenshtein) (TS `levenshtein`).
#[wasm_bindgen(js_name = levenshtein)]
#[must_use]
pub fn levenshtein_js(a: &str, b: &str, limit: Option<f64>) -> f64 {
    analysis_outline::levenshtein(a, b, limit.unwrap_or(f64::INFINITY))
}

#[wasm_bindgen(typescript_custom_section)]
const GROUP_RECURRING_LINES_TS: &str = r"
/** Lines grouped by (near-)identical text; the members are the caller's own line objects. */
export function groupRecurringLines<T>(lines: readonly T[], textOf: (line: T) => string, pageOf: (line: T) => number): { key: string; pages: Set<number>; members: T[] }[];
";

/// [`group_recurring_lines`](analysis_outline::group_recurring_lines) (TS `groupRecurringLines`):
/// lines grouped by (near-)identical text. `textOf` runs over every line, then `pageOf`; the
/// members are the caller's own line objects.
///
/// # Errors
///
/// Fails if `textOf` does not return strings or `pageOf` numbers, or rethrows what they throw.
#[wasm_bindgen(js_name = groupRecurringLines, skip_typescript)]
pub fn group_recurring_lines_js(
    lines: JsValue,
    text_of: &Function,
    page_of: &Function,
) -> Result<JsValue, JsValue> {
    let lines: Vec<JsValue> = lines.unchecked_into::<Array>().iter().collect();
    let texts = Array::new();
    for line in &lines {
        let _ = texts.push(&text_of.call1(&JsValue::UNDEFINED, line)?);
    }
    let pages = Array::new();
    for line in &lines {
        let _ = pages.push(&page_of.call1(&JsValue::UNDEFINED, line)?);
    }
    let texts: Vec<String> = serde_wasm_bindgen::from_value(texts.into())?;
    let pages: Vec<f64> = serde_wasm_bindgen::from_value(pages.into())?;
    let indices: Vec<usize> = (0..texts.len()).collect();
    let groups = analysis_outline::group_recurring_lines(
        indices.as_slice(),
        |&i| texts.get(i).cloned().unwrap_or_default(),
        |&i| pages.get(i).copied().unwrap_or(f64::NAN),
    );
    let out = Array::new();
    for group in groups {
        let page_set = Set::new(&JsValue::UNDEFINED);
        for page in &group.pages {
            let _ = page_set.add(&JsValue::from_f64(*page));
        }
        let members: Array = group
            .members
            .into_iter()
            .map(|&i| lines.get(i).cloned().unwrap_or(JsValue::UNDEFINED))
            .collect();
        let row = Object::new();
        let _ = Reflect::set(
            &row,
            &JsValue::from_str("key"),
            &JsValue::from_str(&group.key),
        )?;
        let _ = Reflect::set(&row, &JsValue::from_str("pages"), &page_set)?;
        let _ = Reflect::set(&row, &JsValue::from_str("members"), &members)?;
        let _ = out.push(&row);
    }
    Ok(out.into())
}

/// [`outline_from_text`](analysis_outline::outline_from_text) (TS `outlineFromText`).
///
/// # Errors
///
/// Fails if `allPages` is not an array of arrays of text items.
#[wasm_bindgen(js_name = outlineFromText, unchecked_return_type = "B.OutlineReaderItem[]")]
pub fn outline_from_text_js(
    #[wasm_bindgen(unchecked_param_type = "readonly (readonly B.OutlineTextItem[])[]")]
    all_pages: JsValue,
) -> JsResult<JsValue> {
    let all_pages: Vec<Vec<OutlineTextItem>> = serde_wasm_bindgen::from_value(all_pages)?;
    to_js(&analysis_outline::outline_from_text(&all_pages))
}

/// [`outline_is_plausible`](analysis_outline::outline_is_plausible) (TS `outlineIsPlausible`).
///
/// # Errors
///
/// Fails if `headings` is not an array of `{ page }` objects.
#[wasm_bindgen(js_name = outlineIsPlausible)]
pub fn outline_is_plausible_js(
    #[wasm_bindgen(unchecked_param_type = "readonly { page: number }[]")] headings: JsValue,
    page_count: f64,
) -> JsResult<bool> {
    let headings: Vec<OutlinePageRef> = serde_wasm_bindgen::from_value(headings)?;
    Ok(analysis_outline::outline_is_plausible(
        &headings, page_count,
    ))
}
