/**
 * Three-way merge, per field. The rule lives in Rust (wf-core sync::merge,
 * wasm `mergeRows` and `sameValue`); this file keeps the row types and forwards.
 *
 * The base is the row as it stood when the local edit was made. Without it
 * there is no way to tell an edit from an unchanged field.
 */
import { rust } from "./rust.js";

export type Row = Record<string, unknown>;

export interface FieldConflict {
  field: string;
  base: unknown;
  local: unknown;
  remote: unknown;
}

/** Named for the merge it belongs to; core already has a wiki-page merge. */
export interface FieldMergeResult {
  merged: Row;
  conflicts: FieldConflict[];
}

export function mergeRows(base: Row, local: Row, remote: Row): FieldMergeResult {
  return rust().mergeRows(base, local, remote);
}

export function sameValue(a: unknown, b: unknown): boolean {
  return rust().sameValue(a, b);
}
