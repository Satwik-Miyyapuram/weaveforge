/**
 * "Find a free copy" messages and ids (Rust `reader::free_copy`). Keeps the
 * signatures of apps/web/src/features/reader/application/find-free-copy.ts.
 */
import {
  describeFreeCopyFailure as rawDescribeFreeCopyFailure,
} from "../pkg/wf_wasm.js";

export {
  isWebArticle,
  openAccessIdsOf,
} from "../pkg/wf_wasm.js";

/** The ids a paper offers the open-access indexes, and its own link split into a PDF or a page. */
export interface FreeCopyIds {
  doi?: string | null;
  arxivId?: string | null;
  pmcid?: string | null;
  knownPdfUrl?: string | null;
  pageUrl?: string | null;
}

/** The "none" outcome of a search: what was listed, tried, and which indexes were asked or unreachable. */
export interface FreeCopyFailure {
  /** The outcome tag the app's search result carries; the message ignores it. */
  kind?: "none";
  listed: number;
  attempts: ReadonlyArray<{
    url: string;
    format: string;
    reason: "not-pdf" | "not-html" | "blocked" | "failed" | "abstract-only" | "no-storage";
  }>;
  unreachable: readonly string[];
  asked: readonly string[];
}

/** The fields of a paper that give its open-access ids. */
export interface FreeCopyPaperLinks {
  doi?: string | null;
  arxivId?: string | null;
  url?: string | null;
  metadata?: unknown;
}

/** The message shown when no free copy opened (Rust `describe_free_copy_failure`). */
export function describeFreeCopyFailure(outcome: FreeCopyFailure, webArticle = false): string {
  return rawDescribeFreeCopyFailure(outcome, webArticle);
}
