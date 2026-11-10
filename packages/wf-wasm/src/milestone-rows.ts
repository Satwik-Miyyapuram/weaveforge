/**
 * Milestone row mapping (Rust `plan::milestone_row`). The column list stays in the web app,
 * next to the queries that select it.
 */
import {
  milestoneFromRow as rawMilestoneFromRow,
  milestoneToRow as rawMilestoneToRow,
} from "../pkg/wf_wasm.js";
import type {
  Milestone,
  MilestoneRowInput,
  MilestoneWriteRow,
} from "./bindings.js";

export type { MilestoneRowInput, MilestoneWriteRow } from "./bindings.js";

/** A `milestones` row as the app's milestone. Null lists become empty lists. */
export function milestoneFromRow(row: MilestoneRowInput): Milestone {
  return rawMilestoneFromRow(row) as Milestone;
}

/** A milestone as the `milestones` row it is written as. */
export function milestoneToRow(milestone: Milestone): MilestoneWriteRow {
  return rawMilestoneToRow(milestone) as MilestoneWriteRow;
}
