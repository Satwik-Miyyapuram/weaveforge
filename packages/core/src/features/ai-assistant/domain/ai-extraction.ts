/**
 * Concept extraction: finding the entities and ideas a workspace is about, so
 * they can become linked wiki pages.
 *
 * The seam is here rather than at `IModelConversation` on purpose. MCP inverts
 * control — an external client calls *us*, so there is no `complete()` to
 * invoke — and forcing both it and a direct API call behind one request/response
 * interface produces an adapter that has to lie about what it can do. Extraction
 * is the honest boundary: it can be satisfied synchronously by a model, or
 * asynchronously by a reviewed proposal, or with no model at all.
 */

export interface ExtractionDocument {
  id: string;
  title: string;
  text: string;
}

export interface ExtractionRequest {
  documents: readonly ExtractionDocument[];
  /**
   * Concepts already in the wiki. Passing them prevents drift — without it an
   * extractor will happily coin "Variational Auto-Encoder" next to an existing
   * "Variational Autoencoder" and split the graph in two.
   */
  existingConcepts?: readonly string[];
  maxConcepts?: number;
}

export type ConceptKind = "concept" | "method" | "dataset" | "metric" | "person" | "venue";

export const CONCEPT_KINDS: readonly ConceptKind[] = [
  "concept",
  "method",
  "dataset",
  "metric",
  "person",
  "venue",
];

export interface ExtractedConcept {
  name: string;
  aliases: readonly string[];
  kind: ConceptKind;
  /** How many documents mention it; drives which concepts are worth a page. */
  mentions: number;
}

export interface ExtractedMention {
  documentId: string;
  conceptName: string;
  /** Verbatim text the concept was found in, for the review queue. */
  evidence: string;
}

export interface ExtractionResult {
  concepts: readonly ExtractedConcept[];
  mentions: readonly ExtractedMention[];
  /**
   * True when the work was handed to something that answers later — the MCP
   * path. Callers must not treat an empty result as "nothing found".
   */
  pending?: boolean;
}

export interface IConceptExtractor {
  readonly id: string;
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
}

export const EMPTY_EXTRACTION: ExtractionResult = { concepts: [], mentions: [] };

/** Signatures of the functions that moved to the Rust core (wf-wasm, crates/wf-core/src/ai/extraction.rs). */
export interface AiExtractionFns {
  /** Normalized key for comparing concept names across casing and spacing. */
  conceptKey(name: string): string;
  /** Merge results, summing mention counts and unioning aliases; most-mentioned first. */
  mergeExtractions(results: readonly ExtractionResult[]): ExtractionResult;
  /** Drop concepts (by name or alias) that already exist in the wiki, and their mentions. */
  withoutExisting(result: ExtractionResult, existing: readonly string[]): ExtractionResult;
}
