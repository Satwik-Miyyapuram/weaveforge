/**
 * Search settings helpers (Rust `search_settings`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/search/search-settings.ts.
 */
export {
  effectiveFieldBoosts,
  kindMultiplier,
  normalizeSearchSettings,
} from "../pkg/wf_wasm.js";

/** Weights outside this range stop being a preference and become a bug. */
export const MIN_FIELD_WEIGHT = 0;
export const MAX_FIELD_WEIGHT = 20;

/** Multiplier applied to a downranked kind. Enough to sink, not to hide. */
export const DOWNRANK_FACTOR = 0.25;
