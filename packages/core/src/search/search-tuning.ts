/** Types for search-tuning. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { SearchDoc } from "./search-port.js";

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

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface SearchTuningFns {
  /**
 * Per-field multipliers. Ordered by how strongly a hit in that field implies
 * the document is *about* the query: a title match is a statement of subject,
 * a body match is a mention.
 */
  readonly FIELD_BOOSTS: { readonly title: 8; readonly aliases: 6; readonly headings: 3; readonly tags: 3; readonly path: 2; readonly body: 1; };
  readonly SEARCH_FIELDS: ("title" | "aliases" | "headings" | "tags" | "path" | "body")[];
  /** Terms shorter than this are matched exactly; prefix matching needs length. */
  readonly MIN_PREFIX_LENGTH: 3;
  /**
 * Edit distance as a fraction of term length, graduated by length. Short terms
 * get none: at three characters almost every other short word is one edit away,
 * so fuzziness there returns noise rather than tolerance for typos.
 */
  fuzzinessForTerm(term: string): number;
  /** Cap on indexed body length. Beyond this a document is noise in every query. */
  readonly MAX_INDEXED_BODY_CHARS: 256000;
  /** Corpus size past which the client index is likely to strain. */
  readonly LARGE_CORPUS_WARNING: 5000;
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
  documentBoost(doc: SearchDoc, options?: DocumentBoostOptions): number;
}
