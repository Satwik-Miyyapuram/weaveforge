/**
 * The three-way merge, re-exported from core.
 *
 * The policy moved to `@weaveforge/core` when the workspace folder needed the
 * same answer for a note edited in two places. This file stays so that
 * offline-sync's own imports keep reading as offline-sync's, and so that the
 * move is visible to anyone following the old path.
 */

export {
  mergeRows,
  type FieldConflict,
  type FieldMergeResult as MergeResult,
  type Row,
} from "@weaveforge/core";
