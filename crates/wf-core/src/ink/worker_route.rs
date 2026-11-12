//! Ink worker message routing and the pen pressure byte. Port of the decision
//! half of `apps/web/src/features/ink/worker/ink-worker.ts`: the guards in
//! `handleMessage` and `pressureByte`. The worker keeps its handlers, canvas,
//! IDB and postMessage.

use serde::{Deserialize, Serialize};

use super::js_math;

/// Message types that run without a guard; the plan names the type itself.
const PASS_THROUGH: &[&str] = &[
    "init",
    "load-page",
    "stroke-begin",
    "erase",
    "undo",
    "redo",
    "save-page",
    "page-model",
    "lasso",
    "select-clear",
    "delete-selection",
    "add-strokes",
    "drag-selection",
    "move-selection",
    "palette",
    "set-background",
    "export-page",
    "resize",
    "viewport",
];

/// What the worker holds that a route depends on.
#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkWorkerRouteState {
    /// The stroke being drawn, or none.
    pub live_stroke_id: Option<String>,
    /// JS number; the page the worker is showing.
    pub page_index: f64,
}

/// One worker message as the route sees it. `kind` is the message's `type`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InkWorkerRouteInput {
    #[serde(rename = "type")]
    pub kind: String,
    pub state: InkWorkerRouteState,
    pub stroke_id: Option<String>,
    pub page_index: Option<f64>,
    pub predicted: Option<bool>,
}

/// The handler the worker runs. `action` is `"ignore"` or a message type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InkWorkerPlan {
    pub action: String,
    /// Only meaningful for `"samples"`: replace the predicted tail, not append.
    pub predicted: bool,
}

fn plan(action: &str) -> InkWorkerPlan {
    InkWorkerPlan {
        action: action.to_owned(),
        predicted: false,
    }
}

/// Which handler a worker message runs, or `"ignore"`.
///
/// - `samples` and `stroke-end` only run for the live stroke with the same id.
/// - `replace-page` and `ink-shown` only run for the page being shown.
/// - Anything unknown, and `samples-returned`, is ignored.
#[must_use]
pub fn ink_worker_route(input: &InkWorkerRouteInput) -> InkWorkerPlan {
    let live_matches = matches!(
        (&input.state.live_stroke_id, &input.stroke_id),
        (Some(live), Some(id)) if live == id
    );
    let page_matches = input.page_index == Some(input.state.page_index);
    match input.kind.as_str() {
        "samples" if live_matches => InkWorkerPlan {
            action: "samples".to_owned(),
            predicted: input.predicted.unwrap_or(false),
        },
        "stroke-end" if live_matches => plan("stroke-end"),
        "replace-page" | "ink-shown" if page_matches => plan(&input.kind),
        kind if PASS_THROUGH.contains(&kind) => plan(kind),
        _ => plan("ignore"),
    }
}

/// The pen's 0 to 1 pressure as the byte the page keeps:
/// `Math.max(0, Math.min(255, Math.round(p * 255)))`. NaN stays NaN, as in the TS.
#[must_use]
pub fn pen_pressure_byte(pressure: f64) -> f64 {
    let scaled = pressure * 255.0;
    if scaled.is_nan() {
        return f64::NAN;
    }
    js_math::max(0.0, js_math::min(255.0, js_math::round(scaled)))
}

#[cfg(test)]
mod tests {
    use super::{InkWorkerRouteInput, InkWorkerRouteState, ink_worker_route, pen_pressure_byte};

    fn route(
        kind: &str,
        live: Option<&str>,
        stroke: Option<&str>,
        page: Option<f64>,
        predicted: Option<bool>,
    ) -> super::InkWorkerPlan {
        ink_worker_route(&InkWorkerRouteInput {
            kind: kind.to_owned(),
            state: InkWorkerRouteState {
                live_stroke_id: live.map(str::to_owned),
                page_index: 2.0,
            },
            stroke_id: stroke.map(str::to_owned),
            page_index: page,
            predicted,
        })
    }

    #[test]
    fn samples_reach_only_the_live_stroke_and_keep_the_predicted_flag() {
        assert_eq!(route("samples", Some("s1"), Some("s1"), None, Some(true)).action, "samples");
        assert!(route("samples", Some("s1"), Some("s1"), None, Some(true)).predicted);
        assert!(!route("samples", Some("s1"), Some("s1"), None, None).predicted);
        assert_eq!(route("samples", Some("s1"), Some("s2"), None, None).action, "ignore");
        assert_eq!(route("samples", None, Some("s1"), None, None).action, "ignore");
    }

    #[test]
    fn stroke_end_commits_only_the_matching_live_stroke() {
        assert_eq!(route("stroke-end", Some("s1"), Some("s1"), None, None).action, "stroke-end");
        assert_eq!(route("stroke-end", Some("s1"), Some("s9"), None, None).action, "ignore");
        assert_eq!(route("stroke-end", None, Some("s1"), None, None).action, "ignore");
    }

    #[test]
    fn page_scoped_messages_drop_a_stale_page() {
        assert_eq!(route("replace-page", None, None, Some(2.0), None).action, "replace-page");
        assert_eq!(route("ink-shown", None, None, Some(1.0), None).action, "ignore");
        assert_eq!(route("replace-page", None, None, None, None).action, "ignore");
    }

    #[test]
    fn pass_through_types_run_and_unknown_or_no_op_types_are_ignored() {
        assert_eq!(route("erase", None, None, None, None).action, "erase");
        assert_eq!(route("samples-returned", None, None, None, None).action, "ignore");
        assert_eq!(route("not-a-type", None, None, None, None).action, "ignore");
    }

    #[test]
    fn pen_pressure_byte_matches_the_ts_rounding() {
        assert_eq!(pen_pressure_byte(0.0), 0.0);
        assert_eq!(pen_pressure_byte(0.5), 128.0);
        assert_eq!(pen_pressure_byte(1.0), 255.0);
        assert_eq!(pen_pressure_byte(1.5), 255.0);
        assert_eq!(pen_pressure_byte(-0.2), 0.0);
        assert_eq!(pen_pressure_byte(f64::INFINITY), 255.0);
        assert!(pen_pressure_byte(f64::NAN).is_nan());
    }
}
