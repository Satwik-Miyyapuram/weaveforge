/**
 * User-tunable ranking. The constants in `search-tuning.ts` are the defaults;
 * these let a user reweight fields, downrank whole kinds, and turn the recency
 * tiebreak off, without any of it reaching the ranking maths as free-form input.
 *
 * Everything is normalized and clamped on the way in: the settings row is
 * user-writable, and an unclamped weight would let a stored value silently
 * break scoring rather than fail visibly.
 */

import { SEARCH_KINDS, type SearchKind } from "./search-port.js";
import { FIELD_BOOSTS, type SearchField } from "./search-tuning.js";

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

/** Weights outside this range stop being a preference and become a bug. */
export const MIN_FIELD_WEIGHT = 0;
export const MAX_FIELD_WEIGHT = 20;

/** Multiplier applied to a downranked kind. Enough to sink, not to hide. */
export const DOWNRANK_FACTOR = 0.25;

const KNOWN_FIELDS = new Set<string>(Object.keys(FIELD_BOOSTS));
const KNOWN_KINDS = new Set<string>(SEARCH_KINDS);

function clampWeight(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(MAX_FIELD_WEIGHT, Math.max(MIN_FIELD_WEIGHT, value));
}

export function normalizeSearchSettings(raw: unknown): SearchSettings | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const input = raw as Partial<SearchSettings>;
  const out: SearchSettings = {};

  if (input.weights && typeof input.weights === "object" && !Array.isArray(input.weights)) {
    const weights: SearchFieldWeights = {};
    for (const [field, value] of Object.entries(input.weights)) {
      if (!KNOWN_FIELDS.has(field)) continue;
      const weight = clampWeight(value);
      if (weight !== undefined) weights[field as SearchField] = weight;
    }
    if (Object.keys(weights).length) out.weights = weights;
  }

  if (Array.isArray(input.downrankedKinds)) {
    const kinds = [...new Set(input.downrankedKinds.filter((k): k is SearchKind => KNOWN_KINDS.has(k)))];
    if (kinds.length) out.downrankedKinds = kinds;
  }

  for (const flag of ["recencyBoost", "ignoreDiacritics", "ignoreArabicDiacritics"] as const) {
    if (typeof input[flag] === "boolean") out[flag] = input[flag];
  }

  return Object.keys(out).length ? out : undefined;
}

/** Effective per-field boosts: defaults with any valid override applied. */
export function effectiveFieldBoosts(settings?: SearchSettings): Record<SearchField, number> {
  return { ...FIELD_BOOSTS, ...(settings?.weights ?? {}) };
}

/** Multiplier for a kind — 1 unless the user pushed that kind down. */
export function kindMultiplier(kind: SearchKind, settings?: SearchSettings): number {
  return settings?.downrankedKinds?.includes(kind) ? DOWNRANK_FACTOR : 1;
}
