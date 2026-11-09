/**
 * Plan feed (Rust `plan::feed`), re-exported from index.ts: the iCalendar of
 * dated milestones and the JSON summary a desktop or home-screen widget reads.
 */
import {
  addDays as rawAddDays,
  milestonesToIcs as rawMilestonesToIcs,
  planWidgetData as rawPlanWidgetData,
} from "../pkg/wf_wasm.js";
import type { FeedMilestone, PlanWidgetData } from "./bindings.js";

/** The `.ics` text for `items`: one all-day event per dated milestone, with a reminder. */
export function milestonesToIcs(
  items: readonly FeedMilestone[],
  options: { includeDone?: boolean; reminderDays?: number; now: Date },
): string {
  return rawMilestonesToIcs(
    items,
    options.includeDone ?? false,
    Math.floor(options.reminderDays ?? 0),
    options.now.getTime(),
  );
}

/** The deadlines a widget draws (soonest first, overdue included) plus overdue and undated counts. */
export function planWidgetData(
  items: readonly FeedMilestone[],
  options: { includeDone?: boolean; limit?: number; now: Date },
): PlanWidgetData {
  return rawPlanWidgetData(
    items,
    options.includeDone ?? false,
    options.limit,
    options.now.getTime(),
  ) as PlanWidgetData;
}

/** `iso` (YYYY-MM-DD) moved by whole calendar days; no time zone can shift it. Throws on a non-date. */
export function addDays(iso: string, days: number): string {
  return rawAddDays(iso, Math.trunc(days));
}
