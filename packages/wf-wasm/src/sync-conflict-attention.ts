/**
 * Open-conflict attention rules (Rust `sync::conflict_attention`), re-exported from index.ts.
 */
import {
  countOpen as rawCountOpen,
  keepAllPicks as rawKeepAllPicks,
  needsPerson as rawNeedsPerson,
} from "../pkg/wf_wasm.js";

/** An open conflict as the panel counts it. */
export interface OpenConflictRef {
  kind: string;
  fieldCount: number;
}

/** A field a bulk pick settles, and the side it takes. */
export interface FieldPick {
  field: string;
  side: "local" | "remote";
}

/** Whether an open conflict still needs a person. */
export function needsPerson(kind: string, fieldCount: number): boolean {
  return rawNeedsPerson(kind, fieldCount);
}

/** How many open conflicts still need a person. */
export function countOpen(open: readonly OpenConflictRef[]): number {
  return rawCountOpen(open);
}

/** The field picks a "keep all" on an edit conflict makes, all on one side. */
export function keepAllPicks(fields: readonly string[], side: "local" | "remote"): FieldPick[] {
  return rawKeepAllPicks(fields, side) as FieldPick[];
}
