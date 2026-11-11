/** Types for paper-relation. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { Identifiable } from "../../../shared/parts.js";
import { ValidationError } from "../../../shared/errors.js";

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

export class PaperRelationValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "PaperRelationValidationError";
  }
}

