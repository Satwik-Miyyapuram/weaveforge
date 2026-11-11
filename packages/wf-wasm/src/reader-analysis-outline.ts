/**
 * Outline-from-text helpers (Rust `reader_analysis::outline`), re-exported from index.ts. Each function keeps
 * the signature and defaults of packages/core/src/features/reader/outline-from-text.ts. Object shapes come from ./bindings.ts.
 *
 * `groupRecurringLines` is generic over the caller's objects, so the Rust side works on indices and this
 * wrapper maps them back to the caller's objects.
 */
import {
  groupRecurringLines as rawGroupRecurringLines,
} from "../pkg/wf_wasm.js";
import type {
  OutlineRecurringGroupIndices,
} from "./bindings.js";

export {
  bodyFontSize,
  isRotatedText,
  levenshtein,
  outlineFromText,
  outlineIsPlausible,
  outlineTextLines,
} from "../pkg/wf_wasm.js";

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

