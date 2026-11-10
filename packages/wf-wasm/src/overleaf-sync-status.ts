/**
 * Overleaf sync status line (Rust `overleaf::sync_status`), re-exported from index.ts.
 */
import { describeOverleafStatus as rawDescribeOverleafStatus } from "../pkg/wf_wasm.js";

export interface OverleafSyncStatus {
  url?: string | null;
  branch: string;
  ahead: number;
  behind: number;
}

/** The one-line status for the Overleaf sync panel. Returns `""` when no status is given. */
export function describeOverleafStatus(status: OverleafSyncStatus | null | undefined): string {
  return rawDescribeOverleafStatus(status ?? null);
}
