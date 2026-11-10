/**
 * Local-first routing rules (Rust `sync::local_first_route`), re-exported from index.ts.
 */
import {
  bothEndsMerge as rawBothEndsMerge,
  isBothEndsRpc as rawIsBothEndsRpc,
  isSyncedTable as rawIsSyncedTable,
  syncedTables as rawSyncedTables,
} from "../pkg/wf_wasm.js";
import type { BothEndsMerge } from "./bindings.js";

/** The table names read and written on this computer. */
export function syncedTables(): readonly string[] {
  return rawSyncedTables() as readonly string[];
}

/** Whether `table` is read and written on this computer. */
export function isSyncedTable(table: string): boolean {
  return rawIsSyncedTable(table);
}

/** Whether the RPC `name` reads both ends. */
export function isBothEndsRpc(name: string): boolean {
  return rawIsBothEndsRpc(name);
}

/** How a both-ends RPC combines its two replies, given which ends failed. */
export function bothEndsMerge(name: string, hereFailed: boolean, thereFailed: boolean): BothEndsMerge {
  return rawBothEndsMerge(name, hereFailed, thereFailed) as BothEndsMerge;
}
