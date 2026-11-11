import type { SearchKind } from "./search-port.js";

// --- related ---
/** Types for related. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
/**
 * "Related to this" — a three-arm cascade, because no single retrieval strategy
 * is right across the range of workspaces this has to serve.
 *
 * On a densely linked workspace, graph expansion finds things a keyword search
 * never would. On a sparse one — which is most workspaces early on — PPR
 * degrades to "here is the seed and nothing else", and lexical similarity is
 * genuinely the better answer. The arm used is reported so the UI can say why,
 * rather than silently returning a worse result.
 */

export type RelatedArm = "graph" | "lexical" | "semantic" | "tags" | "none";

export interface RelatedResult {
  id: string;
  score: number;
  /** The method that ranked it first — what the list is headed with. */
  arm: RelatedArm;
  /**
   * Every method that found it, strongest first, when more than one ran. A
   * paper both linked from the seed and close to it in meaning says so.
   */
  arms?: readonly RelatedArm[];
  /**
   * Cosine similarity to the seed, 0–1, when the meaning arm found it. The
   * fused `score` is a rank blend and means nothing as a number; this does.
   */
  similarity?: number;
}

// --- search-tuning ---
/** Types for search-tuning. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
export type SearchField = "title" | "aliases" | "headings" | "tags" | "path" | "body";

export interface DocumentBoostOptions {
  /** Reference time for recency; injected so tests are deterministic. */
  now?: number;
  /** Half-life for the recency tiebreak. */
  recencyHalfLifeDays?: number;
  /** Multiplier from user settings (kind downranking). Defaults to 1. */
  kindMultiplier?: number;
  /** Set false to drop the recency tiebreak entirely. */
  recency?: boolean;
}

// --- search-settings ---
/** Types for search-settings. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
export type SearchFieldWeights = Partial<Record<SearchField, number>>;

export interface SearchSettings {
  /** Overrides for `FIELD_BOOSTS`; absent fields keep their default. */
  weights?: SearchFieldWeights;
  /** Kinds pushed down the results without being excluded. */
  downrankedKinds?: SearchKind[];
  /** Recency tiebreak; on by default. */
  recencyBoost?: boolean;
  /** Fold diacritics when tokenizing; on by default. */
  ignoreDiacritics?: boolean;
  /** Additionally fold Arabic harakat. */
  ignoreArabicDiacritics?: boolean;
}

// --- wiki-graph ---
/** Types for wiki-graph. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
export interface WikiGraph {
  nodes: string[];
  /** Adjacency, undirected: a link implies relatedness in both directions. */
  edges: Map<string, string[]>;
}

export interface GraphDensity {
  nodes: number;
  edges: number;
  /** Mean degree; the reference cascade uses density to pick an arm. */
  meanDegree: number;
  /** Fraction of nodes in the largest connected component. */
  largestComponentRatio: number;
}
