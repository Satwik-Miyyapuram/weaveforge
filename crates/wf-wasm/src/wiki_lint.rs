//! Wiki lint for JavaScript (wf-core `ai::wiki_lint`). The JS names match
//! `packages/core/src/features/ai-assistant/domain/wiki-lint.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::wiki_lint::{self, LintReport, WikiPageRef};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`lint_wiki`](wiki_lint::lint_wiki). A missing `otherTitles` means none, as in the TS default.
///
/// # Errors
///
/// Fails if `pages` is not a list of `{ id, title, body, aliases? }` objects, or `otherTitles`
/// is not a list of strings.
#[wasm_bindgen(js_name = lintWiki)]
pub fn lint_wiki_js(pages: JsValue, other_titles: JsValue) -> JsResult<JsValue> {
    let pages: Vec<WikiPageRef> = serde_wasm_bindgen::from_value(pages)?;
    let other_titles: Vec<String> = if other_titles.is_undefined() || other_titles.is_null() {
        Vec::new()
    } else {
        serde_wasm_bindgen::from_value(other_titles)?
    };
    to_js(&wiki_lint::lint_wiki(&pages, &other_titles))
}

/// [`plan_fix_order`](wiki_lint::plan_fix_order).
///
/// # Errors
///
/// Fails if `report` is not a `LintReport` object.
#[wasm_bindgen(js_name = planFixOrder)]
pub fn plan_fix_order_js(report: JsValue) -> JsResult<JsValue> {
    let report: LintReport = serde_wasm_bindgen::from_value(report)?;
    to_js(&wiki_lint::plan_fix_order(&report))
}
