import type { DesktopBridge } from "./desktop-bridge";
import type { ExportRunner } from "./migrate-097-upgrade";

/**
 * The desktop export for the upgrade screen; null outside the shell.
 * The exporter loads on the first run: the screens that offer it are in the shell
 * every route ships, and the export runs once per folder.
 */
export function desktopRunExport(shell: DesktopBridge | null): ExportRunner | null {
  if (!shell) return null;
  return async (folder, onProgress) => {
    const { desktopDeps, makeDesktopRunner } = await import("./migrate-097-desktop");
    return makeDesktopRunner(shell, desktopDeps(shell))(folder, onProgress);
  };
}
