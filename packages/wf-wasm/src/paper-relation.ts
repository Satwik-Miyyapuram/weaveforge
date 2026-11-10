/**
 * Paper relation domain rules (Rust `paper_relation`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/relations/domain/paper-relation.ts.
 */
import {
  createPaperRelationWith as rawCreatePaperRelationWith,
  paperRelationInputError as rawPaperRelationInputError,
  dedupePaperRelationRows as rawDedupePaperRelationRows,
} from "../pkg/wf_wasm.js";
import type {
  NewPaperRelationInput,
  PaperRelation,
  PaperRelationRow,
  RelationType,
} from "./bindings.js";

export {
  paperRelationFromRow,
  paperRelationToRow,
} from "../pkg/wf_wasm.js";

export type { PaperRelationRow };

export const RELATION_TYPES: readonly RelationType[] = [
  "cites",
  "extends",
  "contradicts",
  "similar",
  "builds_on",
  "uses_method",
];

/** The validation message for relation input, if it is invalid. */
export function paperRelationInputError(input: NewPaperRelationInput): string | undefined {
  // An unknown type would fail to deserialize in Rust; report it as the TS rule did.
  if (!RELATION_TYPES.includes(input.relation)) return `Unknown relation "${input.relation}".`;
  return rawPaperRelationInputError(input);
}

/** A new relation from valid input, with the id and timestamp given. */
export function createPaperRelationWith(
  input: NewPaperRelationInput,
  id: string,
  createdAt: string,
): PaperRelation {
  return rawCreatePaperRelationWith(input, id, createdAt) as PaperRelation;
}

/** A new relation from caller input. Throws `PaperRelationValidationError` before drawing an id. */
export function createPaperRelation(
  input: NewPaperRelationInput,
  deps: { clock: { nowIso(): string }; ids: { newId(): string } },
): PaperRelation {
  const message = paperRelationInputError(input);
  if (message != null) {
    const error = new Error(message);
    error.name = "PaperRelationValidationError";
    throw error;
  }
  const id = deps.ids.newId();
  const now = deps.clock.nowIso();
  return createPaperRelationWith(input, id, now);
}

/**
 * One row per id, in first-seen order; a later row with the same id replaces the data but keeps
 * its place. A relation on both sides of a paper appears once. Rust `relation_rows`.
 */
export function dedupePaperRelationRows(rows: readonly PaperRelationRow[]): PaperRelationRow[] {
  return rawDedupePaperRelationRows(rows) as PaperRelationRow[];
}
