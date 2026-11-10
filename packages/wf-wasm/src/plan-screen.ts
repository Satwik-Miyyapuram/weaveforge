/**
 * Plan screen ordering and summary text (Rust `plan::screen`), re-exported from index.ts.
 */
import { planEyebrow as rawPlanEyebrow, sortByDue as rawSortByDue } from "../pkg/wf_wasm.js";
import type { Milestone } from "./bindings.js";

/** Dated milestones soonest first, undated ones after. Stable. Rust reads only `targetDate`. */
export function sortByDue<M extends Pick<Milestone, "targetDate">>(milestones: readonly M[]): M[] {
  return rawSortByDue(milestones) as M[];
}

/** "3 milestones · 1 done", or `undefined` when there are no milestones. */
export function planEyebrow(total: number, done: number): string | undefined {
  return rawPlanEyebrow(total, done) as string | undefined;
}
