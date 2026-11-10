/**
 * Outside-edit triage (Rust `workspace::outside_edits`). Decides which changes made in
 * the connected folder are taken in without asking, and why the rest wait for review.
 */
import {
  renamedOutsidePaths as rawRenamedOutsidePaths,
  splitOutsideEdits as rawSplitOutsideEdits,
} from "../pkg/wf_wasm.js";
import type {
  ChangeSide,
  HeldReason,
  OutsideEditSplit,
  OutsideNoteEntry,
  OutsideRowEntry,
} from "./bindings.js";

export type { HeldReason, OutsideEditSplit, OutsideNoteEntry, OutsideRowEntry } from "./bindings.js";

/** What the preview saw of one folder file. */
export interface OutsideSeenFile {
  side: ChangeSide;
  newPath?: boolean;
  renamedFrom?: string;
}

/** Held flags for notes and rows, and the first reason per held path. */
export function splitOutsideEdits(input: {
  notes: OutsideNoteEntry[];
  rows: OutsideRowEntry[];
  seen: Readonly<Record<string, OutsideSeenFile>>;
}): OutsideEditSplit {
  return rawSplitOutsideEdits(input) as OutsideEditSplit;
}

/** Paths of renamed notes among `paths`, in order and without repeats. */
export function renamedOutsidePaths(
  seen: Readonly<Record<string, OutsideSeenFile>>,
  paths: readonly string[],
): string[] {
  return rawRenamedOutsidePaths(seen, [...paths]) as string[];
}
