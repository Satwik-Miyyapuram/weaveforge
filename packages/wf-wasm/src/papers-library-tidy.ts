/**
 * Library tidy-up (Rust `papers::library_tidy`). Re-exported from index.ts. The types are
 * generated from Rust into bindings.ts.
 */
import {
  titleFixes as rawTitleFixes,
  findDuplicateGroups as rawFindDuplicateGroups,
  pickKeeper as rawPickKeeper,
  isConferenceCopy as rawIsConferenceCopy,
} from "../pkg/wf_wasm.js";
import type { DuplicateGroup, TidyPaper, TitleFix } from "./bindings.js";

export type {
  DuplicateGroup,
  DuplicateReason,
  TidyPaper,
  TitleFix,
  TitleLookup,
} from "./bindings.js";

/** The fix each paper's title needs. Only papers whose title needs one are listed. */
export function titleFixes(papers: readonly TidyPaper[]): TitleFix[] {
  return rawTitleFixes(papers) as TitleFix[];
}

/** Groups of two or more papers that are the same paper. */
export function findDuplicateGroups(papers: readonly TidyPaper[]): DuplicateGroup[] {
  return rawFindDuplicateGroups(papers) as DuplicateGroup[];
}

/** The id of the copy to keep from a non-empty group. Throws on an empty group. */
export function pickKeeper(group: readonly TidyPaper[]): string {
  return rawPickKeeper(group);
}

/** Whether the paper is the published version rather than a preprint. */
export function isConferenceCopy(paper: TidyPaper): boolean {
  return rawIsConferenceCopy(paper);
}
