/**
 * Lab snapshot row mapping (Rust `lab_snapshot_rows`). The row shape stays in the web app,
 * next to the queries that select it.
 */
import type {
  LabSnapshot,
  LabSnapshotRow,
} from "./bindings.js";

export {
  labSnapshotRowToDomain,
} from "../pkg/wf_wasm.js";

export type { LabSnapshot, LabSnapshotRow } from "./bindings.js";

