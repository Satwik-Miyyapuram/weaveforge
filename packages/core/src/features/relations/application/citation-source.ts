/**
 * Citation-source contract (for automatic edge discovery).
 *
 * Given a paper reference, a source returns the references it cites as a list
 * of `PaperRef`s. Each external provider (Semantic Scholar, OpenCitations,
 * Crossref) implements this interface; adding one is a new class, never an edit
 * to the linking use-case (Open/Closed Principle).
 */

import type { PaperRef } from "../../papers/application/metadata-source.js";

export interface CitationCandidate {
  /** Stable provider paper id used for deduplication. */
  id: string;
  title: string;
  authors: string[];
  year?: number;
  url?: string;
  /** How many times this citing paper is itself cited, when the source provides it. */
  citationCount?: number;
}

export interface ICitationSource {
  /** Stable id, e.g. "semantic-scholar". */
  readonly id: string;
  /** Whether this source can resolve citations for the given reference. */
  supports(ref: PaperRef): boolean;
  /** The references (outgoing citations) of the given paper. */
  references(ref: PaperRef): Promise<PaperRef[]>;
  /**
   * Optional batch variant: resolve references for many papers in one call.
   * Returns one entry per input ref (same order); `null` for papers the source
   * couldn't resolve. Sources that support it (e.g. Semantic Scholar's
   * `/paper/batch`) let the linker avoid N sequential, rate-limited requests.
   */
  referencesBatch?(refs: PaperRef[]): Promise<(PaperRef[] | null)[]>;
  /** Incoming papers that cite this paper, used by saved citation alerts. */
  citations?(ref: PaperRef): Promise<CitationCandidate[]>;
}
