import type { SearchExcerpt } from "./search-excerpt.js";

/**
 * Search contracts. Types and interfaces only — the ranking library lives in
 * the web app so this package keeps its zero-dependency guarantee.
 *
 * The index is a projection of the workspace snapshot, not of the folder
 * mirror: the folder is optional, and search has to work without it.
 */

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
  /** Query terms that matched, for highlighting. */
  terms: readonly string[];
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
  search(query: string, options?: SearchQueryOptions): readonly SearchHit[];
  /** JSON for the IndexedDB cache. */
  serialize(): string;
}

export interface IWorkspaceSearchIndexFactory {
  create(docs: readonly SearchDoc[]): IWorkspaceSearchIndex;
  /** Returns null when the payload is from an incompatible schema/revision. */
  load(serialized: string, revision: string): IWorkspaceSearchIndex | null;
}
