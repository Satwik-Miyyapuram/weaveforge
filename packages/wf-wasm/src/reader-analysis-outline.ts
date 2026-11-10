/**
 * Outline-from-text helpers (Rust `reader_analysis::outline`), re-exported from index.ts. Each function keeps
 * the signature and defaults of packages/core/src/features/reader/outline-from-text.ts. Object shapes come from ./bindings.ts.
 *
 * `groupRecurringLines` is generic over the caller's objects, so the Rust side works on indices and this
 * wrapper maps them back to the caller's objects.
 */
import {
  isRotatedText as rawIsRotatedText,
  outlineTextLines as rawOutlineTextLines,
  bodyFontSize as rawBodyFontSize,
  levenshtein as rawLevenshtein,
  groupRecurringLines as rawGroupRecurringLines,
  outlineFromText as rawOutlineFromText,
} from "../pkg/wf_wasm.js";
import type {
  OutlineTextItem,
  OutlineReaderItem,
  OutlineRecurringGroupIndices,
} from "./bindings.js";

export {
  outlineIsPlausible,
} from "../pkg/wf_wasm.js";

/** True when a pdf.js text matrix `[a, b, c, d, e, f]` sets its run rotated or mirrored. */
export function isRotatedText(transform: readonly number[]): boolean {
  return rawIsRotatedText(Float64Array.from(transform));
}

/** Consecutive text runs on a baseline, per page, joined in reading order. */
export function outlineTextLines(pages: readonly (readonly OutlineTextItem[])[]): OutlineTextItem[] {
  return rawOutlineTextLines(pages) as OutlineTextItem[];
}

/** The most common font size, rounded to a half point; 0 when there is none. */
export function bodyFontSize(pages: readonly (readonly OutlineTextItem[])[]): number {
  return rawBodyFontSize(pages);
}

/** Edit distance, capped at `limit` so the running-head test stays cheap on long lines. */
export function levenshtein(a: string, b: string, limit = Number.POSITIVE_INFINITY): number {
  return rawLevenshtein(a, b, limit);
}

/** Group lines by (near-)identical text. Members keep the caller's objects. */
export function groupRecurringLines<T>(
  lines: readonly T[],
  textOf: (line: T) => string,
  pageOf: (line: T) => number,
): { key: string; pages: Set<number>; members: T[] }[] {
  const groups = rawGroupRecurringLines(
    lines.map((line) => textOf(line)),
    lines.map((line) => pageOf(line)),
  ) as OutlineRecurringGroupIndices[];
  return groups.map((group) => ({
    key: group.key,
    // f64 crosses as `number | null` in the bindings; these are always finite.
    pages: new Set(group.pages as number[]),
    members: (group.members as number[]).map((index) => lines[index]!),
  }));
}

/** Infer an outline only when a document supplies no bookmarks. No pdf.js dependency. */
export function outlineFromText(allPages: readonly (readonly OutlineTextItem[])[]): OutlineReaderItem[] {
  return rawOutlineFromText(allPages) as OutlineReaderItem[];
}

