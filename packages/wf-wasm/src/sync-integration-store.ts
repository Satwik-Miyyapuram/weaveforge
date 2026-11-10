/**
 * Integration branch rules (Rust `sync::integration_store`): what branch an integration
 * reads back from its stored row, and what branch it writes. The row reads and the
 * upsert stay in `features/sync/infrastructure/postgrest-integrations-store.ts`.
 */
import { branchRead as rawBranchRead, branchSave as rawBranchSave } from "../pkg/wf_wasm.js";
import type { BranchReadInput, BranchSaveInput } from "./bindings.js";

export type { BranchReadInput, BranchSaveInput } from "./bindings.js";

/** The branch an integration reads back from its stored `branch` column. */
export function branchRead(input: BranchReadInput): string {
  return rawBranchRead(input);
}

/** The `branch` value to store for an integration. */
export function branchSave(input: BranchSaveInput): string {
  return rawBranchSave(input);
}
