/**
 * Folder sync report line (Rust `workspace::sync_report`), re-exported from index.ts.
 * Replaces the sentence building in apps/web/src/features/workspace/application/workspace-folder.ts.
 */
import { describeSync as rawDescribeSync } from "../pkg/wf_wasm.js";
import type { SyncReport } from "./bindings.js";

/** The one line the panel shows after a sync. A failed commit is said, not read as "up to date". */
export function describeSync(report: SyncReport): string {
  return rawDescribeSync(report);
}
