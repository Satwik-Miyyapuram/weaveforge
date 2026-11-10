/**
 * Settling an open conflict (Rust `sync::conflict_settle`). The SQL that stores each
 * outcome stays in TypeScript; these decide what the outcome is.
 */
import {
  sameRow as rawSameRow,
  settleConflictPlan as rawSettleConflictPlan,
} from "../pkg/wf_wasm.js";
import type { ConflictSettlePlan } from "./bindings.js";

export type { ConflictSettlePlan } from "./bindings.js";

/** The settle decision for a conflict of `kind`, given its sides and the server's row. */
export function settleConflictPlan(
  kind: "edit" | "deleted_remote" | "deleted_local",
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
): ConflictSettlePlan {
  return rawSettleConflictPlan(kind, base, local, remote) as ConflictSettlePlan;
}

/** Whether two rows hold the same value for every field; a missing field equals null. */
export function sameRow(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return rawSameRow(a, b);
}
