/** Types for search-settings. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { SearchKind } from "./search-port.js";
import type { SearchField } from "./search-tuning.js";

export type SearchFieldWeights = Partial<Record<SearchField, number>>;

export interface SearchSettings {
  /** Overrides for `FIELD_BOOSTS`; absent fields keep their default. */
  weights?: SearchFieldWeights;
  /** Kinds pushed down the results without being excluded. */
  downrankedKinds?: readonly SearchKind[];
  /** Recency tiebreak; on by default. */
  recencyBoost?: boolean;
  /** Fold diacritics when tokenizing; on by default. */
  ignoreDiacritics?: boolean;
  /** Additionally fold Arabic harakat. */
  ignoreArabicDiacritics?: boolean;
}

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface SearchSettingsFns {
  /** Weights outside this range stop being a preference and become a bug. */
  readonly MIN_FIELD_WEIGHT: 0;
  readonly MAX_FIELD_WEIGHT: 20;
  /** Multiplier applied to a downranked kind. Enough to sink, not to hide. */
  readonly DOWNRANK_FACTOR: 0.25;
  normalizeSearchSettings(raw: unknown): SearchSettings | undefined;
  /** Effective per-field boosts: defaults with any valid override applied. */
  effectiveFieldBoosts(settings?: SearchSettings): Record<SearchField, number>;
  /** Multiplier for a kind — 1 unless the user pushed that kind down. */
  kindMultiplier(kind: SearchKind, settings?: SearchSettings): number;
}
