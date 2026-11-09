/**
 * Which pages of a PDF the user meant: `all`, or a list like `1,3-5` (Rust
 * `ink::pdf_pages`), re-exported from index.ts.
 */
import {
  isAllPages as rawIsAllPages,
  pageListProblem as rawPageListProblem,
  parsePageList as rawParsePageList,
  selectedPdfPages as rawSelectedPdfPages,
} from "../pkg/wf_wasm.js";

import type { PageSelection } from "./bindings.js";

export type { PageSelection };

/** Parse `all` (any case, alone) as "every page", needing only the count. */
export function isAllPages(answer: string): boolean {
  return rawIsAllPages(answer);
}

/** Parse a page list against a document of `count` pages. */
export function parsePageList(answer: string, count: number): PageSelection {
  return rawParsePageList(answer, count);
}

/** The whole answer, bounds applied. `[]` means do nothing. */
export function selectedPdfPages(answer: string, count: number): number[] {
  return rawSelectedPdfPages(answer, count);
}

/** The validation line for an answer, or `null` if it is good. */
export function pageListProblem(answer: string, count: number): string | null {
  return rawPageListProblem(answer, count);
}
