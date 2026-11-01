/**
 * The three-way merge, on the Rust core.
 *
 * The policy runs in Rust (wf-core `sync::merge`) through `readyCore()`. This
 * file stays so that offline-sync's own imports keep reading as offline-sync's,
 * and so that the move is visible to anyone following the old path.
 */

import { readyCore } from "@/lib/rust-core";
import type { Row, FieldMergeResult } from "@weaveforge/core";

export type { FieldConflict, FieldMergeResult as MergeResult, Row } from "@weaveforge/core";

/** Three-way merge per field, on the Rust core. Rows cross as plain JSON. */
export function mergeRows(base: Row, local: Row, remote: Row): FieldMergeResult {
  return readyCore().mergeRows(base, local, remote) as FieldMergeResult;
}

/** Equality as the database means it, on the Rust core. */
export function sameValue(a: unknown, b: unknown): boolean {
  return readyCore().sameValue(a, b);
}
