/**
 * Pull decisions for the offline-sync Puller (Rust `sync::puller_plan`), re-exported from
 * index.ts. Summarizes a pull page, picks the apply and tombstone steps, and parses
 * unique-constraint clashes. The shapes come from bindings.ts, generated from the Rust types.
 */
import {
  uniqueConstraintName as rawUniqueConstraintName,
} from "../pkg/wf_wasm.js";
import type {
  ApplyStep,
  OpFact,
  OpenConflictKind,
  PullFacts,
  PullSummary,
  PullSummaryInput,
  SeqRow,
  TombstoneStep,
} from "./bindings.js";

export {
  isUniqueClash,
  pullApplyStep,
  pullSummary,
  pullTombstoneStep,
} from "../pkg/wf_wasm.js";

export type {
  ApplyStep,
  OpFact,
  OpenConflictKind,
  PullFacts,
  PullSummary,
  PullSummaryInput,
  SeqRow,
  TombstoneStep,
} from "./bindings.js";

/** The quoted constraint name in a unique-constraint error message, or undefined. */
export function uniqueConstraintName(message: string): string | undefined {
  return rawUniqueConstraintName(message) ?? undefined;
}

