/**
 * Plan screen ordering and summary text (Rust `plan::screen`), re-exported from index.ts.
 */
import {
  sortByDue as rawSortByDue,
} from "../pkg/wf_wasm.js";
import type {
  Milestone,
} from "./bindings.js";

export {
  planEyebrow,
} from "../pkg/wf_wasm.js";

/** Dated milestones soonest first, undated ones after. Stable. Rust reads only `targetDate`. */
export function sortByDue<M extends Pick<Milestone, "targetDate">>(milestones: readonly M[]): M[] {
  return rawSortByDue(milestones) as M[];
}

