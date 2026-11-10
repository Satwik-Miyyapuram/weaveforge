/**
 * Milestone row mapping (Rust `plan::milestone_row`). The column list stays in the web app,
 * next to the queries that select it.
 */
import type {
  Milestone,
  MilestoneRowInput,
  MilestoneWriteRow,
} from "./bindings.js";

export {
  milestoneFromRow,
  milestoneToRow,
} from "../pkg/wf_wasm.js";

export type { MilestoneRowInput, MilestoneWriteRow } from "./bindings.js";

