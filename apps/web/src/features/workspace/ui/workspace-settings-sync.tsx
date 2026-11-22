"use client";

import { useEffect } from "react";
import { activeWorkspaceFs, onFolderConnected } from "@/features/workspace/application/workspace-folder";
import { bindWorkspaceSettingsFolder, workspaceSettings } from "@/features/settings/application/workspace-settings";
import { SETTINGS_PATH } from "@/features/settings/application/workspace-settings-file";
import { holdCloseWhile } from "@/lib/desktop/close-flush";
import { desktop } from "@/lib/desktop/desktop-bridge";

/**
 * Keeps `.weaveforge/settings.json` and the app in step: reads it when a folder
 * connects, re-reads it when the desktop watcher says it changed (an edit by
 * hand, a git pull), and writes pending changes before the window goes away.
 */
export function WorkspaceSettingsSync() {
  useEffect(() => {
    bindWorkspaceSettingsFolder(activeWorkspaceFs);
    const load = () => void workspaceSettings.load();
    if (activeWorkspaceFs()) load();
    const stopFolder = onFolderConnected(load);
    const stopWatch =
      desktop()?.onVaultChange((paths) => {
        if (paths.some((p) => p.replace(/\\/g, "/").endsWith(SETTINGS_PATH))) load();
      }) ?? (() => {});
    const flush = () => void workspaceSettings.flush();
    const close = () => void workspaceSettings.close();
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", close);
    window.addEventListener("beforeunload", close);
    document.addEventListener("visibilitychange", onHidden);
    // The desktop close waits until that write has landed.
    const stopHold = holdCloseWhile(() => workspaceSettings.busy());
    return () => {
      stopHold();
      stopFolder();
      stopWatch();
      window.removeEventListener("pagehide", close);
      window.removeEventListener("beforeunload", close);
      document.removeEventListener("visibilitychange", onHidden);
      close();
    };
  }, []);
  return null;
}
