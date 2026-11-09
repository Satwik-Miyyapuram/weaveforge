/**
 * Zotero-projected and local reader annotations merged (Rust
 * `reader::merge_annotations`), re-exported from index.ts.
 */
import { mergeReaderAnnotations as rawMergeReaderAnnotations } from "../pkg/wf_wasm.js";

/**
 * Zotero and local rows as one list sorted by `sortIndex`. A local row wins on id
 * collision, and a Zotero row a local row already sent to Zotero is dropped.
 * Returns copies of the rows, not the same objects. Any row with `id`, `zoteroKey`
 * and `sortIndex` fits.
 */
export function mergeReaderAnnotations<T extends { id: string; zoteroKey?: string | null; sortIndex: string }>(
  zotero: readonly T[],
  local: readonly T[],
): T[] {
  return rawMergeReaderAnnotations(zotero, local) as T[];
}
