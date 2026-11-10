/**
 * Settling an open conflict (Rust `sync::conflict_settle`). The SQL that stores each
 * outcome stays in TypeScript; these decide what the outcome is.
 */
import type {
  ConflictSettlePlan,
} from "./bindings.js";

export {
  sameRow,
  settleConflictPlan,
} from "../pkg/wf_wasm.js";

export type { ConflictSettlePlan } from "./bindings.js";

