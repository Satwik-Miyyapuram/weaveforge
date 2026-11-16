"use client";

import { useEffect } from "react";

import { createAutoSync, wireAutoSync } from "../application/auto-sync";
import { folderRemoteSync, pullThenPush, remoteSyncAvailable } from "../application/parts-2";
import { folderSession, onFolderConnected, onVaultCommit } from "../application/workspace-folder";

/**
 * Runs git auto-sync for the desktop app's workspace folder. Paints nothing;
 * the status bar's dot shows what it is doing.
 *
 * It starts with the app and asks each time whether there is anything to sync:
 * with no desktop folder, no remote or no token, a run is a quiet no-op. A
 * folder connected later is synced at once.
 */
export function GitAutoSync() {
  useEffect(() => {
    if (!remoteSyncAvailable()) return;
    const engine = createAutoSync({
      remote: () =>
        folderSession()?.kind === "desktop" ? folderRemoteSync("settings") : Promise.resolve({ url: null, hasToken: false }),
      sync: pullThenPush,
      isOnline: () => navigator.onLine,
      now: Date.now,
    });
    const unwire = wireAutoSync(engine, { onCommit: onVaultCommit, target: window });
    const offConnected = onFolderConnected(() => engine.nudge());
    return () => {
      offConnected();
      unwire();
    };
  }, []);

  return null;
}
