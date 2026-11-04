/**
 * Citation text helpers (Rust `reader_analysis::text`), re-exported from index.ts. Each function keeps
 * the signature and defaults of packages/core/src/features/reader/analysis/citation-text.ts,
 * text-fingerprint.ts and title-similarity.ts. Object shapes come from ./bindings.ts.
 *
 * `itemToRect` is exported here as `citationItemToRect`: that name is taken by another lane.
 */
import {
  stripInvisible as rawStripInvisible,
  composeSpacingAccents as rawComposeSpacingAccents,
  fontSizeOf as rawFontSizeOf,
  searchTextFromItems as rawSearchTextFromItems,
  originalRange as rawOriginalRange,
  citationItemToRect as rawCitationItemToRect,
  mentionRects as rawMentionRects,
  surnameKey as rawSurnameKey,
  rectanglesOverlap as rawRectanglesOverlap,
  textFingerprint as rawTextFingerprint,
  titleSimilarity as rawTitleSimilarity,
  isBibliographicMatch as rawIsBibliographicMatch,
} from "../pkg/wf_wasm.js";
import type {
  AnalysisPdfItem,
  AnalysisSearchText,
} from "./bindings.js";

/** Removes zero-width characters and maps no-break and thin spaces to a space. */
export function stripInvisible(text: string): string {
  return rawStripInvisible(text);
}

/** Puts TeX spacing accents back on the letter after them ("Ball´e" becomes "Ballé"). */
export function composeSpacingAccents(text: string): string {
  return rawComposeSpacingAccents(text);
}

/** Font size of a text item in user-space units. */
export function fontSizeOf(item: AnalysisPdfItem): number {
  return rawFontSizeOf(item);
}

/** Normalised search text where every unit maps back to its raw span. */
export function searchTextFromItems(items: readonly AnalysisPdfItem[]): AnalysisSearchText {
  return rawSearchTextFromItems(items) as AnalysisSearchText;
}

/** The raw `[start, end]` span of `view.text[start..end]`. */
export function originalRange(view: AnalysisSearchText, start: number, end: number): [number, number] {
  return rawOriginalRange(view, start, end) as [number, number];
}

/** The PDF rect `[x0, y0, x1, y1]` of `item.str[from..to]`, or null. */
export function citationItemToRect(item: AnalysisPdfItem, from = 0, to = item.str.length): number[] | null {
  return rawCitationItemToRect(item, from, to) as number[] | null;
}

/** The PDF rects covering the normalised span `start..end`. */
export function mentionRects(items: readonly AnalysisPdfItem[], start: number, end: number): number[][] {
  return rawMentionRects(items, start, end) as number[][];
}

/** A stable key for a surname: accents and particles removed, lowercased, letters only. */
export function surnameKey(name: string): string {
  return rawSurnameKey(name);
}

/** True if two rects `[x0, y0, x1, y1]` overlap with positive area. */
export function rectanglesOverlap(a: readonly number[], b: readonly number[]): boolean {
  return rawRectanglesOverlap(Float64Array.from(a), Float64Array.from(b));
}

/** Sixteen hex characters from two FNV-1a passes over the text layer. */
export function textFingerprint(texts: readonly string[]): string {
  return rawTextFingerprint(texts);
}

/** Token-set Dice similarity in `0..=1`, insensitive to punctuation, accents and word order. */
export function titleSimilarity(left: string, right: string): number {
  return rawTitleSimilarity(left, right);
}

/** True when the titles are at least 0.85 similar and the years differ by at most one. */
export function isBibliographicMatch(
  hints: { title?: string | null; year?: number | null },
  candidate: { title: string; year?: number | null },
): boolean {
  return rawIsBibliographicMatch(hints, candidate);
}
