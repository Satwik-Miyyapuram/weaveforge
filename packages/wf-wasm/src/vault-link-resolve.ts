/**
 * Note-link helpers (Rust `vault::link_resolve`), re-exported from index.ts: which existing note a
 * `[[title]]` resolves to, and the message for link targets that failed to load.
 */
import {
  findTitleMatch as rawFindTitleMatch,
  linkTargetsError as rawLinkTargetsError,
} from "../pkg/wf_wasm.js";

/**
 * Index of the first existing title matching `title` once both are normalised, or `undefined`
 * when none matches or `title` is blank.
 */
export function findTitleMatch(existingTitles: readonly string[], title: string): number | undefined {
  return rawFindTitleMatch([...existingTitles], title);
}

/**
 * The message naming link targets that failed to load, or `undefined` when none failed.
 */
export function linkTargetsError(failed: readonly string[]): string | undefined {
  return rawLinkTargetsError([...failed]);
}
