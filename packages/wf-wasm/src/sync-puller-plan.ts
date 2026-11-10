/**
 * Pull decisions for the offline-sync Puller (Rust `sync::puller_plan`), re-exported from
 * index.ts. Summarizes a pull page, picks the apply and tombstone steps, and parses
 * unique-constraint clashes. The shapes come from bindings.ts, generated from the Rust types.
 */
import {
  isUniqueClash as rawIsUniqueClash,
  pullApplyStep as rawPullApplyStep,
  pullSummary as rawPullSummary,
  pullTombstoneStep as rawPullTombstoneStep,
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

/** The highest seq, whether more pages may follow, and which failed changes are stale. */
export function pullSummary(input: PullSummaryInput): PullSummary {
  return rawPullSummary(input) as PullSummary;
}

/** The step a pull apply takes for one remote change. */
export function pullApplyStep(facts: PullFacts): ApplyStep {
  return rawPullApplyStep(facts) as ApplyStep;
}

/** The step a pull tombstone takes for one deleted remote change. */
export function pullTombstoneStep(facts: PullFacts): TombstoneStep {
  return rawPullTombstoneStep(facts) as TombstoneStep;
}

/** The quoted constraint name in a unique-constraint error message, or undefined. */
export function uniqueConstraintName(message: string): string | undefined {
  return rawUniqueConstraintName(message) ?? undefined;
}

/** Whether an error message is a unique-constraint clash. */
export function isUniqueClash(message: string): boolean {
  return rawIsUniqueClash(message);
}
