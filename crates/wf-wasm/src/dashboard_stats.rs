//! Dashboard stats for JavaScript (wf-core `dashboard::stats`). The JS names match the
//! wrappers in `packages/core/src/features/dashboard/domain/dashboard-stats.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::dashboard::stats::{
    self, StatExperiment, StatLog, StatMilestone, StatPaper, StatSupervisee, StatTag,
};

use super::to_js;

/// [`needs_attention`](stats::needs_attention) for the given papers, milestones, experiments,
/// and `today` (`yyyy-mm-dd`).
///
/// # Errors
///
/// Fails if an input cannot be read as the expected shape.
#[wasm_bindgen(js_name = dashboardNeedsAttention)]
pub fn dashboard_needs_attention(
    papers: JsValue,
    milestones: JsValue,
    experiments: JsValue,
    today: &str,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let papers: Vec<StatPaper> = serde_wasm_bindgen::from_value(papers)?;
    let milestones: Vec<StatMilestone> = serde_wasm_bindgen::from_value(milestones)?;
    let experiments: Vec<StatExperiment> = serde_wasm_bindgen::from_value(experiments)?;
    to_js(&stats::needs_attention(
        &papers,
        &milestones,
        &experiments,
        today,
    ))
}

/// [`top_tags`](stats::top_tags) with the `limit` most-used tags.
///
/// # Errors
///
/// Fails if `tags` cannot be read as the expected shape.
#[wasm_bindgen(js_name = dashboardTopTags)]
pub fn dashboard_top_tags(tags: JsValue, limit: u32) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let tags: Vec<StatTag> = serde_wasm_bindgen::from_value(tags)?;
    to_js(&stats::top_tags(&tags, limit as usize))
}

/// [`supervisee_counts`](stats::supervisee_counts) for one supervisee.
///
/// # Errors
///
/// Fails if an input cannot be read as the expected shape.
#[wasm_bindgen(js_name = dashboardSuperviseeCounts)]
pub fn dashboard_supervisee_counts(
    milestones: JsValue,
    logs: JsValue,
    today: &str,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let milestones: Vec<StatMilestone> = serde_wasm_bindgen::from_value(milestones)?;
    let logs: Vec<StatLog> = serde_wasm_bindgen::from_value(logs)?;
    to_js(&stats::supervisee_counts(&milestones, &logs, today))
}

/// [`team_attention`](stats::team_attention) across all supervisees.
///
/// # Errors
///
/// Fails if `supervisees` cannot be read as the expected shape.
#[wasm_bindgen(js_name = dashboardTeamAttention)]
pub fn dashboard_team_attention(
    supervisees: JsValue,
    today: &str,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let supervisees: Vec<StatSupervisee> = serde_wasm_bindgen::from_value(supervisees)?;
    to_js(&stats::team_attention(&supervisees, today))
}
