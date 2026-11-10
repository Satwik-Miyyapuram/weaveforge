/**
 * Search settings helpers (Rust `search_settings`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/search/search-settings.ts.
 */
import {
  effectiveFieldBoosts as rawEffectiveFieldBoosts,
  kindMultiplier as rawKindMultiplier,
} from "../pkg/wf_wasm.js";
import type {
  FieldBoosts,
  SearchKind,
  SearchSettings,
} from "./bindings.js";

export {
  normalizeSearchSettings,
} from "../pkg/wf_wasm.js";

/** Weights outside this range stop being a preference and become a bug. */
export const MIN_FIELD_WEIGHT = 0;
export const MAX_FIELD_WEIGHT = 20;

/** Multiplier applied to a downranked kind. Enough to sink, not to hide. */
export const DOWNRANK_FACTOR = 0.25;

/** Effective per-field boosts: defaults with any valid override applied. */
export function effectiveFieldBoosts(settings?: SearchSettings): FieldBoosts {
  return rawEffectiveFieldBoosts(settings) as FieldBoosts;
}

/** Multiplier for a kind: 1 unless the user pushed that kind down. */
export function kindMultiplier(kind: SearchKind, settings?: SearchSettings): number {
  return rawKindMultiplier(kind, settings);
}
