/**
 * Find-match scrollbar ticks (Rust `reader_find_marks`), re-exported from index.ts. The page lookups the
 * TS caller used to pass as callbacks are now precomputed into `pages`.
 */
import { findMarks as rawFindMarks } from "../pkg/wf_wasm.js";
import type { FindMarkMatch, FindMarkPage } from "./bindings.js";

export type { FindMark, FindMarkMatch, FindMarkPage } from "./bindings.js";

/**
 * Where each match falls in the document, as a fraction of its full height. A match whose page text is not
 * loaded yet sits at the top of its page. Rust always fills both fields (the TS `FindMark` had no nulls),
 * so the wrapper narrows the generated `number | null` fields.
 */
export function findMarks(
  matches: readonly FindMarkMatch[],
  numPages: number,
  pages: readonly FindMarkPage[],
): { index: number; fraction: number }[] {
  return rawFindMarks(matches, numPages, pages) as { index: number; fraction: number }[];
}
