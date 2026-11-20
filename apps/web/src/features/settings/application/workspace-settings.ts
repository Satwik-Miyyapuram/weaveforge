/**
 * The one settings file for the open workspace (`.weaveforge/settings.json`).
 * Every toolbar reads and writes through this instance. The folder is bound
 * by `WorkspaceSettingsSync`, so this module stays light: it does not import
 * the workspace folder code (the ink bar imports it).
 */
import type { IWorkspaceFs } from "@weaveforge/core";
import { logToApp } from "@/lib/error-report/app-log";
import { showToast } from "@/lib/toast";
import { WorkspaceSettingsFile } from "./workspace-settings-file";

let folder: () => IWorkspaceFs | null = () => null;

export const workspaceSettings = new WorkspaceSettingsFile({
  fs: () => folder(),
  warn: (message) => {
    logToApp({ level: "warn", source: "workspace", message });
    showToast(message);
  },
});

/** The sync component points the instance at the open folder. */
export function bindWorkspaceSettingsFolder(get: () => IWorkspaceFs | null): void {
  folder = get;
}
