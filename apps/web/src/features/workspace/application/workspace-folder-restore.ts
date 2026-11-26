import { desktop } from "@/lib/desktop/desktop-bridge";

/**
 * Settles once the launch-time folder restore has had its answer.
 *
 * Something that reads through `activeWorkspaceFs` in the first moments of a
 * session — an ink note opened straight from a link — would otherwise see no
 * folder, read the bucket instead, and show the note empty. A browser has no
 * remembered folder, so there is nothing to wait for; on the desktop the wait
 * is capped, so a restore that never reports cannot hold the reader forever.
 */
const FOLDER_RESTORE_WAIT_MS = 10_000;
let settleRestore!: () => void;
const restoreSettled = new Promise<void>((resolve) => {
  settleRestore = resolve;
});
let restoreWait: Promise<void> | null = null;

export function folderRestored(): Promise<void> {
  if (!desktop()) return Promise.resolve();
  restoreWait ??= Promise.race([
    restoreSettled,
    new Promise<void>((resolve) => setTimeout(resolve, FOLDER_RESTORE_WAIT_MS)),
  ]);
  return restoreWait;
}

/** Called by the launch-time restore when it has connected, or given up. */
export function markFolderRestored(): void {
  settleRestore();
}
