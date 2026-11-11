/** Types for search-settings. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { SearchKind } from "./search-port.js";
import type { SearchField } from "./search-tuning.js";

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

