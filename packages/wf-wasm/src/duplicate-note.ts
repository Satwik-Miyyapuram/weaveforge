/**
 * The plan for a duplicate note (Rust `editor_workspace::duplicate_note`),
 * re-exported from index.ts.
 */
import { duplicatePlan as rawDuplicatePlan } from "../pkg/wf_wasm.js";

import type { DuplicatePlan, DuplicateSource } from "./bindings.js";

export type { DuplicatePlan, DuplicateSource };

/**
 * What to create for a duplicate, or `null` when the document is not a note or
 * its body is still the preview.
 */
export function duplicatePlan(
  doc: DuplicateSource | null | undefined,
  documents: readonly DuplicateSource[],
): DuplicatePlan | null {
  return rawDuplicatePlan(doc ?? null, documents);
}
