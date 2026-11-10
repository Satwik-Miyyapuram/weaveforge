/**
 * Logbook list helpers (Rust `logbook::log_view`). Callers pass today as `yyyy-mm-dd` from
 * the local calendar, so the Rust side never reads the clock or a locale.
 */
import {
  groupByDay as rawGroupByDay,
  logEyebrow as rawLogEyebrow,
  newestFirstOrder as rawNewestFirstOrder,
  splitHeadline as rawSplitHeadline,
  streakDays as rawStreakDays,
} from "../pkg/wf_wasm.js";
import type { LogDayGroup, LogHeadlineSplit } from "./bindings.js";

export type { LogDayGroup, LogHeadlineSplit } from "./bindings.js";

/** Entry dates grouped by day, newest day first. */
export function groupByDay(entryDates: readonly string[]): LogDayGroup[] {
  return rawGroupByDay(entryDates) as LogDayGroup[];
}

/** Consecutive days with an entry, counting back from `today` (or yesterday). */
export function streakDays(entryDates: readonly string[], today: string): number {
  return rawStreakDays(entryDates, today);
}

/** "62 entries · 9-day streak", or `undefined` with no entries. */
export function logEyebrow(entryDates: readonly string[], today: string): string | undefined {
  return rawLogEyebrow(entryDates, today) as string | undefined;
}

/** The headline and rest of an entry body. */
export function splitHeadline(body: string): LogHeadlineSplit {
  return rawSplitHeadline(body) as LogHeadlineSplit;
}

/** Indexes of `publishedAt` stamps, latest first. */
export function newestFirstOrder(publishedAt: readonly string[]): number[] {
  return rawNewestFirstOrder(publishedAt) as number[];
}
