/** Search and text Rust function signatures (chunks, fusion, PageRank, acronyms). */
import type { WikiGraph } from "../../search/wiki-graph.js";

/** Signatures of the text functions that live in the Rust core (wf-wasm). */
export interface TextFns {
  /** Words in plain text: runs of non-whitespace. Rust `count_words`. */
  countWords(text: string): number;
}

/** Personalized PageRank over the wiki graph (Rust wf-core, exposed by wf-wasm). */
export interface PprOptions {
  numWalks?: number;
  maxSteps?: number;
  /** Teleport probability back to the seed. */
  damping?: number;
  /** Injected for deterministic tests; production uses Math.random. */
  rng?: () => number;
}

export interface RelatedNode {
  id: string;
  score: number;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface PersonalizedPagerankFns {
  /** Visit probabilities from `seed`, as a map of node -> score. */
  personalizedPageRank(graph: WikiGraph, seed: string, options?: PprOptions): Map<string, number>;
  /** Top-k neighbours by PPR, excluding the seed itself. */
  relatedByPpr(graph: WikiGraph, seed: string, limit?: number, options?: PprOptions): RelatedNode[];
}

/** Passage split for embedding (Rust wf-core, exposed by wf-wasm). */
export interface TextChunk {
  text: string;
  /** Offset in the source, so a hit can point at the passage it matched. */
  start: number;
  end: number;
}

export interface ChunkOptions {
  /** Characters per passage. */
  maxChars?: number;
  /** Characters repeated between neighbours. */
  overlapChars?: number;
  /** Below this a trailing fragment is merged back rather than embedded alone. */
  minChars?: number;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface TextChunksFns {
  /** Split text into overlapping passages. */
  chunkForEmbedding(text: string, options?: ChunkOptions): TextChunk[];
}

/** Keyword/vector arm preparation for hybrid fusion (Rust wf-core, exposed by wf-wasm). */
export interface HybridFusionFns {
  /** Weight of the vector list in fusion; the keyword list is 1. */
  readonly HYBRID_VECTOR_WEIGHT: 1.5;
  /** Fewest of the query's content terms a keyword hit must match to be fused. */
  readonly HYBRID_MIN_TERM_COVERAGE: 0.5;
  /** Once the best vector hit clears the encoder's floor, this many top hits are kept. */
  readonly HYBRID_VECTOR_KEEP_TOP: 5;
  /** The query with bare function words removed, for the keyword arm. */
  stripStopwords(query: string): string;
  /** Distinct non-empty terms; callers pass the query's index terms. */
  queryTermCount(terms: readonly string[]): number;
  /** Keyword hits that matched enough of the query to be worth fusing. */
  coveredHits<T extends { queryTerms?: readonly string[] }>(hits: readonly T[], termCount: number, minCoverage?: number): T[];
  /** Vector hits, best first, gated by the encoder's floor. */
  gateVectorHits<T extends { score: number }>(hits: readonly T[], floor: number, keepTop?: number): T[];
}

/** Acronyms worth indexing for a title (Rust wf-core, exposed by wf-wasm). */
export interface SearchAcronymsFns {
  /** Usually one acronym; empty for titles that are already short. */
  acronymsForTitle(title: string): string[];
}
