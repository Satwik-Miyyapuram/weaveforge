/** Types for three-way-merge. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */

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

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface ThreeWayMergeFns {
  mergeRows(base: Row, local: Row, remote: Row): FieldMergeResult;
  sameValue(a: unknown, b: unknown): boolean;
}
