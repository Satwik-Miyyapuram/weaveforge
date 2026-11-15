//! Dashboard stats for JavaScript (wf-core `dashboard::stats`). The JS names match the
//! wrappers in `packages/core/src/features/dashboard/domain/parts.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::dashboard::stats::{self, StatLog, StatMilestone, StatSupervisee, StatsInput};

use super::to_js;

/// [`supervisee_counts`](stats::supervisee_counts) for one supervisee.
///
/// # Errors
///
/// Fails if an input cannot be read as the expected shape.
#[wasm_bindgen(js_name = dashboardSuperviseeCounts, unchecked_return_type = "unknown")]
pub fn dashboard_supervisee_counts(
    #[wasm_bindgen(unchecked_param_type = "unknown")] milestones: JsValue,
    #[wasm_bindgen(unchecked_param_type = "unknown")] logs: JsValue,
    today: &str,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let milestones: Vec<StatMilestone> = serde_wasm_bindgen::from_value(milestones)?;
    let logs: Vec<StatLog> = serde_wasm_bindgen::from_value(logs)?;
    to_js(&stats::supervisee_counts(&milestones, &logs, today))
}

/// [`build_dashboard_stats`](stats::build_dashboard_stats) for the whole dashboard.
///
/// # Errors
///
/// Fails if `input` cannot be read as the expected shape.
#[wasm_bindgen(js_name = dashboardBuildStats, unchecked_return_type = "unknown")]
pub fn dashboard_build_stats(
    #[wasm_bindgen(unchecked_param_type = "unknown")] input: JsValue,
    today: &str,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let input: StatsInput = serde_wasm_bindgen::from_value(input)?;
    to_js(&stats::build_dashboard_stats(&input, today))
}

/// [`team_attention`](stats::team_attention) across all supervisees.
///
/// # Errors
///
/// Fails if `supervisees` cannot be read as the expected shape.
#[wasm_bindgen(js_name = dashboardTeamAttention, unchecked_return_type = "unknown")]
pub fn dashboard_team_attention(
    #[wasm_bindgen(unchecked_param_type = "unknown")] supervisees: JsValue,
    today: &str,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let supervisees: Vec<StatSupervisee> = serde_wasm_bindgen::from_value(supervisees)?;
    to_js(&stats::team_attention(&supervisees, today))
}
