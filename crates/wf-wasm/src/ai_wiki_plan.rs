//! Wiki page planning for JavaScript (wf-core `ai::wiki_plan`). The JS names match
//! `packages/core/src/features/ai-assistant/application/plan-wiki-pages.use-case.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::ai::wiki_plan::{self, PlanWikiPagesInput, WikiPagePlan};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`wiki_proposal_content`](wiki_plan::wiki_proposal_content) for a `WikiPagePlan` object.
///
/// # Errors
///
/// Fails if `plan` is not a wiki page plan object.
#[wasm_bindgen(js_name = wikiProposalContent, unchecked_return_type = "string")]
pub fn wiki_proposal_content_js(
    #[wasm_bindgen(unchecked_param_type = "B.WikiPagePlan")] plan: JsValue,
) -> JsResult<JsValue> {
    let plan: WikiPagePlan = serde_wasm_bindgen::from_value(plan)?;
    to_js(&wiki_plan::wiki_proposal_content(&plan))
}

/// [`plan_wiki_pages`](wiki_plan::plan_wiki_pages) for a `PlanWikiPagesInput` object; returns the plans.
///
/// # Errors
///
/// Fails if `input` has the wrong shape, or the plans cannot be converted.
#[wasm_bindgen(js_name = planWikiPages, unchecked_return_type = "B.WikiPagePlan[]")]
pub fn plan_wiki_pages_js(
    #[wasm_bindgen(unchecked_param_type = "B.PlanWikiPagesInput")] input: JsValue,
) -> JsResult<JsValue> {
    let input: PlanWikiPagesInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&wiki_plan::plan_wiki_pages(&input))
}
