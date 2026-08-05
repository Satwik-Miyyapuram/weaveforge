/**
 * Ranking rules, kept out of the adapter so they can be unit-tested without a
 * search library and later exposed as user settings.
 */

import type { SearchDoc } from "./search-port.js";

/**
 * Per-field multipliers. Ordered by how strongly a hit in that field implies
 * the document is *about* the query: a title match is a statement of subject,
 * a body match is a mention.
 */
export const FIELD_BOOSTS = {
  title: 8,
  aliases: 6,
  headings: 3,
  tags: 3,
  path: 2,
  body: 1,
} as const;

export type SearchField = keyof typeof FIELD_BOOSTS;

export const SEARCH_FIELDS = Object.keys(FIELD_BOOSTS) as SearchField[];

/** Terms shorter than this are matched exactly; prefix matching needs length. */
export const MIN_PREFIX_LENGTH = 3;

/**
 * Edit distance as a fraction of term length, graduated by length. Short terms
 * get none: at three characters almost every other short word is one edit away,
 * so fuzziness there returns noise rather than tolerance for typos.
 */
export function fuzzinessForTerm(term: string): number {
  if (term.length <= 3) return 0;
  if (term.length <= 5) return 0.1;
  return 0.2;
}

/** Cap on indexed body length. Beyond this a document is noise in every query. */
export const MAX_INDEXED_BODY_CHARS = 256_000;

/** Corpus size past which the client index is likely to strain. */
export const LARGE_CORPUS_WARNING = 5_000;

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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Document-level multiplier, applied on top of field scoring.
 *
 * Degree leads and recency only breaks ties. Omnisearch boosts by mtime, which
 * suits a journal but not a literature workspace: a 2017 paper cited from
 * fifteen notes is more likely to be wanted than yesterday's scratch note, and
 * a recency-led ranking buries it. Link degree is the closer proxy for "this is
 * load-bearing in my work". Degree is 0 until the graph phase fills it in, at
 * which point this strengthens on its own.
 */
export function documentBoost(doc: SearchDoc, options: DocumentBoostOptions = {}): number {
  const now = options.now ?? Date.now();
  const halfLife = options.recencyHalfLifeDays ?? 180;

  // Saturating rather than linear: the gap between 0 and 5 links is meaningful,
  // between 60 and 65 it is not, and linear growth would let hubs win outright.
  const degreeBoost = 1 + Math.log1p(Math.max(0, doc.degree)) / Math.log(10);
  const kindFactor = options.kindMultiplier ?? 1;

  const updated = Date.parse(doc.updatedAt);
  if (options.recency === false || !Number.isFinite(updated)) return degreeBoost * kindFactor;

  const ageDays = Math.max(0, (now - updated) / DAY_MS);
  // Bounded to [1, 1.15] so it can only order documents the content score has
  // already tied — never overturn a genuinely better match.
  const recencyBoost = 1 + 0.15 * Math.pow(0.5, ageDays / halfLife);

  return degreeBoost * recencyBoost * kindFactor;
}
