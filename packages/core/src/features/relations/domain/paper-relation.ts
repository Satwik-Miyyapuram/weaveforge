/**
 * Paper relations domain model — pure, no I/O, no SDK imports.
 *
 * A `PaperRelation` is a typed, directed edge between two papers. Together the
 * edges + papers form the literature graph. One reason to change: the rules of
 * what a relation *is* (SRP).
 */

import type { Identifiable } from "../../../shared/repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";

export type RelationType =
  | "cites"
  | "extends"
  | "contradicts"
  | "similar"
  | "builds_on"
  | "uses_method";

export const RELATION_TYPES: readonly RelationType[] = [
  "cites",
  "extends",
  "contradicts",
  "similar",
  "builds_on",
  "uses_method",
];

export interface PaperRelation extends Identifiable {
  id: string;
  fromPaper: string;
  toPaper: string;
  relation: RelationType;
  note?: string;
  /** How the edge was created: a manual entry or an automatic citation match. */
  source: "manual" | "auto";
  createdAt: string;
}

export interface NewPaperRelationInput {
  fromPaper: string;
  toPaper: string;
  relation: RelationType;
  note?: string;
  source?: "manual" | "auto";
}

export interface PaperRelationFilter {
  relation?: RelationType;
  fromPaper?: string;
  toPaper?: string;
}

export class PaperRelationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperRelationValidationError";
  }
}

export function createPaperRelation(
  input: NewPaperRelationInput,
  deps: { clock: Clock; ids: IdGenerator },
): PaperRelation {
  if (!input.fromPaper || !input.toPaper) {
    throw new PaperRelationValidationError("Both fromPaper and toPaper are required.");
  }
  if (input.fromPaper === input.toPaper) {
    throw new PaperRelationValidationError("A paper cannot relate to itself.");
  }
  if (!RELATION_TYPES.includes(input.relation)) {
    throw new PaperRelationValidationError(`Unknown relation "${input.relation}".`);
  }
  return {
    id: deps.ids.newId(),
    fromPaper: input.fromPaper,
    toPaper: input.toPaper,
    relation: input.relation,
    note: input.note,
    source: input.source ?? "manual",
    createdAt: deps.clock.nowIso(),
  };
}
