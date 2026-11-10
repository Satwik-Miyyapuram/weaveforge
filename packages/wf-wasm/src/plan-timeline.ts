/**
 * Plan timeline layout (Rust `plan::timeline`), re-exported from index.ts. Each function keeps the
 * signature of apps/web/src/features/plan/application/plan-timeline.ts, except that `today` is the
 * caller's local day (`yyyy-mm-dd`) in place of a `Date`.
 */
import {
  clusterMarks as rawClusterMarks,
  daysUntilDate as rawDaysUntilDate,
  planPace as rawPlanPace,
  planTimeline as rawPlanTimeline,
} from "../pkg/wf_wasm.js";
import type { Milestone, PlanTimeline, PlanTimelineCluster, PlanTimelineMark } from "./bindings.js";

/** The plan laid out in time, or `null` when no milestone has a date. */
export function planTimeline(milestones: readonly Milestone[], today: string): PlanTimeline | null {
  return rawPlanTimeline(milestones, today) ?? null;
}

/** Marks nearer than `minGap` (track percent) folded into clusters. */
export function clusterMarks(marks: readonly PlanTimelineMark[], minGap: number): PlanTimelineCluster[] {
  return rawClusterMarks(marks, minGap);
}

/** Calendar days from `today` to `iso`, or `null` unless both are real dates. */
export function daysUntilDate(iso: string, today: string): number | null {
  return rawDaysUntilDate(iso, today) ?? null;
}

/** `"on track"`, or how many are overdue, then how many fall due within two weeks. */
export function planPace(milestones: readonly Milestone[], today: string): string {
  return rawPlanPace(milestones, today);
}
