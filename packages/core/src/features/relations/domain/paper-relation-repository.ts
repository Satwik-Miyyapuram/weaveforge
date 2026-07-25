/**
 * Repository contract for paper relations (graph edges).
 *
 * Defined in the domain layer (DIP). Adds graph-shaped reads on top of the
 * generic read/write contract. Every implementation passes the shared contract
 * suite (Liskov).
 */

import type {
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/repository.js";
import type {
  PaperRelation,
  PaperRelationFilter,
  RelationType,
} from "./paper-relation.js";

export interface IPaperRelationRepository
  extends IReadableRepository<PaperRelation, PaperRelationFilter>,
    IWritableRepository<PaperRelation> {
  /** Every edge (the full graph). */
  getGraph(): Promise<PaperRelation[]>;
  /** All edges touching a paper, in either direction. */
  relationsFor(paperId: string): Promise<PaperRelation[]>;
  /** Dedupe lookup for a specific directed, typed edge. */
  findEdge(
    fromPaper: string,
    toPaper: string,
    relation: RelationType,
  ): Promise<PaperRelation | null>;
}
