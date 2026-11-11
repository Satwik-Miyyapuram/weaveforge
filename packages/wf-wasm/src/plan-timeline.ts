/**
 * Plan timeline layout (Rust `plan::timeline`), re-exported from index.ts. Each function keeps the
 * signature of apps/web/src/features/plan/application/plan-timeline.ts, except that `today` is the
 * caller's local day (`yyyy-mm-dd`) in place of a `Date`.
 */
export {
  clusterMarks,
  daysUntilDate,
  planPace,
  planTimeline,
} from "../pkg/wf_wasm.js";
