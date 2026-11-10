/**
 * Library index rules (Rust `search::library_index`), re-exported from modules.ts.
 * Each function keeps the behaviour of apps/web/src/features/search/application/auto-index-library.ts
 * and index-library-pdfs.ts.
 */
import {
  courtesyPauseDue as rawCourtesyPauseDue,
  recentFailureIds as rawRecentFailureIds,
} from "../pkg/wf_wasm.js";

/**
 * The paper ids whose failure is still inside the retry window at `now`, from a record of
 * `{ paperId: failedAtMs }`.
 */
export function recentFailureIds(failures: Record<string, number>, now: number): string[] {
  return rawRecentFailureIds(failures, now) as string[];
}

/** Whether the loop waits before the next paper's host: after a real fetch, once something happened. */
export function courtesyPauseDue(fromCache: boolean, indexed: number, failed: number): boolean {
  return rawCourtesyPauseDue(fromCache, indexed, failed);
}
