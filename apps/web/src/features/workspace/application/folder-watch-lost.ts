/**
 * Whether the shell's folder watch has stopped seeing the folder.
 *
 * A rename, move or unplugged drive leaves the watch looking at nothing, and
 * outside edits stop arriving without a sound. The shell says so once; this
 * keeps what it said until the folder is let go or watched again, so the panel
 * can say it too.
 */

import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { notifyEach } from "@/lib/notify-each";

let lostReason: string | null = null;
const listeners = new Set<(reason: string | null) => void>();

function setLost(reason: string | null): void {
  if (reason === lostReason) return;
  lostReason = reason;
  notifyEach(listeners, "folder-watch-lost", reason);
}

/** What the shell said when the watch lost the folder, or null while it is watching. */
export function folderWatchLost(): string | null {
  return lostReason;
}

/** Hears each change of `folderWatchLost`; answers with the way to stop. */
export function onFolderWatchLost(listener: (reason: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Hear the shell say the watch lost its folder. Stopping, as closing the folder
 * or watching it again does, forgets what was said.
 */
export function watchForLoss(bridge: Pick<DesktopBridge, "onVaultWatchLost">): () => void {
  setLost(null);
  const stop = bridge.onVaultWatchLost?.((reason) => setLost(reason)) ?? (() => {});
  return () => {
    stop();
    setLost(null);
  };
}
