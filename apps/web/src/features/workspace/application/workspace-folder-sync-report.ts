import type { WorkspaceCommit } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import type { WebMirrorResult } from "./parts-2";

export interface SyncOutcome {
  mirror: WebMirrorResult;
  commit: WorkspaceCommit | null;
  /** Why no commit was made, when git refused or failed. */
  commitError?: string;
}

/** One line for the panel; a failed commit is said, not read as "up to date" (wf-core `workspace::sync_report`). */
export function describeSync({ mirror, commit, commitError }: SyncOutcome): string {
  return readyCore().describeSync({
    written: mirror.written.length,
    removed: mirror.removed.length,
    commitMessage: commit?.message ?? null,
    commitError: commitError ?? null,
  });
}
