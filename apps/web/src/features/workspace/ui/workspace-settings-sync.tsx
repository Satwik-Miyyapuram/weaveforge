"use client";

import { useEffect } from "react";
import { activeWorkspaceFs, onFolderConnected } from "@/features/workspace/application/workspace-folder";
import { bindWorkspaceSettingsFolder, workspaceSettings } from "@/features/settings/application/workspace-settings";
import { SETTINGS_PATH } from "@/features/settings/application/workspace-settings-file";
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
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      stopFolder();
      stopWatch();
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onHidden);
      flush();
    };
  }, []);
  return null;
}
