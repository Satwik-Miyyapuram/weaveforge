/**
 * Local-first routing rules (Rust `sync::local_first_route`), re-exported from index.ts.
 */
import {
  syncedTables as rawSyncedTables,
} from "../pkg/wf_wasm.js";

export {
  bothEndsMerge,
  isBothEndsRpc,
  isSyncedTable,
} from "../pkg/wf_wasm.js";

/** The table names read and written on this computer. */
export function syncedTables(): readonly string[] {
  return rawSyncedTables() as readonly string[];
}

