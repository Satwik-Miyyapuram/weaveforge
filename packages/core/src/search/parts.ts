// --- search-port ---
/**
 * Search contracts. Types and interfaces only — the ranking library lives in
 * the web app so this package keeps its zero-dependency guarantee.
 *
 * The index is a projection of the workspace snapshot, not of the folder
 * mirror: the folder is optional, and search has to work without it.
 */
export interface ExcerptRange {
  start: number;
  end: number;
}

export interface SearchExcerpt {
  /** The snippet, with leading/trailing ellipses where it was cut. */
  text: string;
  /** Highlight ranges, as offsets into `text`. */
  highlights: ExcerptRange[];
}

/** Every entity kind the workspace index covers. */
export const SEARCH_KINDS = [
  "note",
  "paper",
  "list",
  "section",
  "experiment",
  "milestone",
  "log",
  "pdf",
  "annotation",
] as const;

export type SearchKind = (typeof SEARCH_KINDS)[number];

/**
 * One indexed record. Fields are separate rather than concatenated so the
 * ranker can weight a title hit above a body hit.
 */
export interface SearchDoc {
  /** `${kind}:${entityId}` — unique across kinds, which share id spaces. */
  id: string;
  kind: SearchKind;
  entityId: string;
  title: string;
  /** Alternative names: wikilink aliases, paper short titles, section numbers. */
  aliases: readonly string[];
  /** Markdown h1–h3 lifted out of the body. */
  headings: readonly string[];
  tags: readonly string[];
  /** Ancestor-title breadcrumb for tree entities, e.g. "Method/Baselines". */
  path: string;
  body: string;
  /** ISO timestamp; falls back to createdAt for entities with no updatedAt. */
  updatedAt: string;
  /** In-app link to the entity. */
  href: string;
  /**
   * Zero-based PDF page, for `pdf` documents only. Carried so a hit can
   * deep-link to the page the match is actually on.
   */
  page?: number;
  /**
   * Wiki-graph link degree. Zero until the graph phase populates it; the
   * ranker treats it as the primary document-level signal once present.
   */
  degree: number;
}

export interface SearchHit {
  id: string;
  kind: SearchKind;
  entityId: string;
  title: string;
  href: string;
  score: number;
  /** Zero-based PDF page for `pdf` hits. */
  page?: number;
  /** ISO 8601 time the document last changed, when the index knows it. */
  updatedAt?: string;
  /** Query terms that matched, for highlighting. */
  terms: readonly string[];
  /**
   * The query's own terms this hit matched, before prefix or fuzzy expansion.
   * Lets hybrid search tell a hit that matched the question from one that
   * matched a single word of it.
   */
  queryTerms?: readonly string[];
  /**
   * Snippet around the matched terms. Built by the index, which holds the body
   * text — the hit itself deliberately does not carry the full document.
   */
  excerpt?: SearchExcerpt;
}

export interface SearchQueryOptions {
  /** Build highlighted snippets. Off by default; costs a scan per hit. */
  excerpts?: boolean;
  limit?: number;
  kinds?: readonly SearchKind[];
  /** Prefix matching for terms at or above the configured length. */
  prefix?: boolean;
  /** `true` uses the graduated rule; a number forces a fixed edit distance. */
  fuzzy?: boolean | number;
}

export interface IWorkspaceSearchIndex {
  /** Corpus fingerprint; a persisted index whose revision differs is stale. */
  readonly revision: string;
  replaceAll(docs: readonly SearchDoc[]): void;
  add(docs: readonly SearchDoc[]): void;
  remove(ids: readonly string[]): void;
  /**
   * Ids currently held for these kinds.
   *
   * What makes a partial refresh possible: re-projecting one kind produces the
   * documents that should be there, and this says which are there now, so the
   * difference can be retracted without touching anything else.
   */
  idsOfKind(kinds: readonly SearchKind[]): string[];
  /**
   * Rebuild a hit from stored fields, for a document another arm ranked.
   *
   * The semantic arm returns ids and nothing else; everything needed to render
   * a result — title, href, kind, page — lives here. Null when the id is not
   * held, which is how a stale vector for a deleted document is discarded.
   */
  hitById(id: string): SearchHit | null;
  search(query: string, options?: SearchQueryOptions): readonly SearchHit[];
  /** JSON for the IndexedDB cache. */
  serialize(): string;
}

export interface IWorkspaceSearchIndexFactory {
  create(docs: readonly SearchDoc[]): IWorkspaceSearchIndex;
  /** Returns null when the payload is from an incompatible schema/revision. */
  load(serialized: string, revision: string): IWorkspaceSearchIndex | null;
}

// --- parts ---
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
