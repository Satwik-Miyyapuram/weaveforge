/**
 * Lab snapshot row mapping (Rust `lab_snapshot_rows`). The row shape stays in the web app,
 * next to the queries that select it.
 */
import { labSnapshotRowToDomain as rawLabSnapshotRowToDomain } from "../pkg/wf_wasm.js";
import type { LabSnapshot, LabSnapshotRow } from "./bindings.js";

export type { LabSnapshot, LabSnapshotRow } from "./bindings.js";

/** A `lab_snapshots` row as a published snapshot (empty content when the row has none). */
export function labSnapshotRowToDomain(row: LabSnapshotRow): LabSnapshot {
  return rawLabSnapshotRowToDomain(row) as LabSnapshot;
}
