/**
 * Citation text helpers (Rust `reader_analysis::text`), re-exported from index.ts. Each function keeps
 * the signature and defaults of CitationTextFns, TextFingerprintFns and TitleSimilarityFns in\n * packages/core/src/shared/core-contract.ts. Object shapes come from ./bindings.ts.
 *
 * `itemToRect` is exported here as `citationItemToRect`: that name is taken by another lane.
 */
import {
  citationItemToRect as rawCitationItemToRect,
  rectanglesOverlap as rawRectanglesOverlap,
  isBibliographicMatch as rawIsBibliographicMatch,
} from "../pkg/wf_wasm.js";
import type {
  AnalysisPdfItem,
} from "./bindings.js";

export {
  mentionRects,
  searchTextFromItems,
  textFingerprint,
} from "../pkg/wf_wasm.js";

export {
  composeSpacingAccents,
  fontSizeOf,
  originalRange,
  stripInvisible,
  surnameKey,
  titleSimilarity,
} from "../pkg/wf_wasm.js";

/** The PDF rect `[x0, y0, x1, y1]` of `item.str[from..to]`, or null. */
export function citationItemToRect(item: AnalysisPdfItem, from = 0, to = item.str.length): number[] | null {
  return rawCitationItemToRect(item, from, to) as number[] | null;
}

/** True if two rects `[x0, y0, x1, y1]` overlap with positive area. */
export function rectanglesOverlap(a: readonly number[], b: readonly number[]): boolean {
  return rawRectanglesOverlap(Float64Array.from(a), Float64Array.from(b));
}

/** True when the titles are at least 0.85 similar and the years differ by at most one. */
export function isBibliographicMatch(
  hints: { title?: string | null; year?: number | null },
  candidate: { title: string; year?: number | null },
): boolean {
  return rawIsBibliographicMatch(hints, candidate);
}
