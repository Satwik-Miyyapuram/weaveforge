/**
 * Repository contract for papers.
 *
 * Defined in the domain layer (Dependency Inversion): application code depends
 * on this interface; infrastructure provides Supabase / in-memory / SQLite
 * implementations. Any implementation must be substitutable (Liskov) and is
 * verified by the shared contract test suite.
 */

import type {
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/repository.js";
import type { Paper, PaperFilter, PaperSummary } from "./paper.js";

export interface IPaperRepository
  extends IReadableRepository<Paper, PaperFilter>,
    IWritableRepository<Paper> {
  /**
   * Lightweight card projection; implementations may fall back to `list()`.
   *
   * Returns {@link PaperSummary}, not `Paper`: the projection drops the
   * abstract, bibtex and metadata bag, and typing it as a full paper is what
   * allowed a summary to be written back over a real row (review-2 F6). An
   * implementation that has the whole row may return it — a `Paper` satisfies
   * `PaperSummary` — but a caller may only rely on the summary fields.
   */
  listSummaries?(): Promise<PaperSummary[]>;
  /** Look up by arXiv id for dedupe on import. Returns null if not present. */
  findByArxivId(arxivId: string): Promise<Paper | null>;
  /** Look up by (normalized) DOI for dedupe on import. */
  findByDoi(doi: string): Promise<Paper | null>;
}
