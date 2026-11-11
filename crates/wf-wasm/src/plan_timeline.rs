//! Plan timeline layout for JavaScript (wf-core `plan::timeline`). The JS names match
//! `apps/web/src/features/plan/application/plan-timeline.ts`. `today` is the caller's local day
//! (`yyyy-mm-dd`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::plan::timeline::{self, PlanTimelineCluster, PlanTimelineMark, TimelineMilestone};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`plan_timeline`](timeline::plan_timeline): the laid-out plan, or `null` when no milestone is
/// dated.
///
/// # Errors
///
/// Fails if `milestones` has the wrong shape.
#[wasm_bindgen(js_name = planTimeline, unchecked_return_type = "B.PlanTimeline | null")]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn plan_timeline_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.Milestone[]")] milestones: JsValue,
    today: String,
) -> JsResult<JsValue> {
    let milestones: Vec<TimelineMilestone> = serde_wasm_bindgen::from_value(milestones)?;
    timeline::plan_timeline(&milestones, &today)
        .map_or(Ok(JsValue::NULL), |timeline| to_js(&timeline))
}

/// [`cluster_marks`](timeline::cluster_marks): marks nearer than `min_gap` stacked into clusters.
///
/// # Errors
///
/// Fails if `marks` has the wrong shape.
#[wasm_bindgen(js_name = clusterMarks, unchecked_return_type = "B.PlanTimelineCluster[]")]
pub fn cluster_marks_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.PlanTimelineMark[]")] marks: JsValue,
    min_gap: f64,
) -> JsResult<JsValue> {
    let marks: Vec<PlanTimelineMark> = serde_wasm_bindgen::from_value(marks)?;
    let clusters: Vec<PlanTimelineCluster> = timeline::cluster_marks(&marks, min_gap);
    to_js(&clusters)
}

/// [`days_until_date`](timeline::days_until_date): the whole days from `today`, or `null`
/// unless both are real dates.
#[wasm_bindgen(js_name = daysUntilDate, unchecked_return_type = "number | null")]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn days_until_date_js(iso: String, today: String) -> JsResult<JsValue> {
    timeline::days_until_date(&iso, &today).map_or(Ok(JsValue::NULL), |days| to_js(&days))
}

/// [`plan_pace`](timeline::plan_pace): `"on track"` or the overdue and due-soon counts.
#[wasm_bindgen(js_name = planPace)]
#[allow(
    clippy::needless_pass_by_value,
    reason = "wasm_bindgen takes strings by value"
)]
pub fn plan_pace_js(
    #[wasm_bindgen(unchecked_param_type = "readonly B.Milestone[]")] milestones: JsValue,
    today: String,
) -> JsResult<String> {
    let milestones: Vec<TimelineMilestone> = serde_wasm_bindgen::from_value(milestones)?;
    Ok(timeline::plan_pace(&milestones, &today))
}
