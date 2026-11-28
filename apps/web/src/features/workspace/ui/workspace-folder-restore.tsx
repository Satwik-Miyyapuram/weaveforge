import { activeWorkspaceFs, chooseDesktopFolder, folderRestored, folderSession, markFolderRestored } from "../application/workspace-folder";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { logToApp } from "@/lib/error-report/app-log";
import { bindWorkspaceSettingsFolder } from "@/features/settings/application/workspace-settings";

/**
 * Take up the remembered workspace folder at startup, once.
 *
 * The shell remembers the chosen folder across launches (a preference and
 * `~/.weaveforge/desktop.json`), and the main process re-verifies the path is
 * still there before answering. What was missing is anyone *asking* at startup:
 * the reconnect lived in the Settings → Workspace panel, so the folder only came
 * back when a reader happened to open that tab. Until then `activeWorkspaceFs()`
 * was `null`, every `requestSync()` was a no-op, and the mirror — which is
 * continuous by design — simply did not run. Edit for an hour after a restart
 * and the folder still held yesterday.
 *
 * Mounted above the project-scoped shell, and once, for two reasons: the mirror
 * is per session and not per project, and `chooseDesktopFolder` writes the
 * git preference when told not to reuse. A second run would be a second
 * connection attempt for no gain.
 *
 * Silent by construction. There is no folder to take up on a fresh install, a
 * remembered folder may be on a drive that is not plugged in, and neither is
 * something to interrupt the first paint over: both leave the session exactly as
 * it was, and the Workspace tab is where a reader goes to connect one.
 */
let asked = false;

/**
 * Called from the shell's first effect, not mounted as a `dynamic()` component: a
 * lazy component's effect waits for React's Suspense reveal (about 300 ms), and
 * every startup read waits for the folder. The settings file reader is bound
 * first, since startup loads it right after the folder.
 */
export function restoreRememberedFolder(): void {
  if (asked) return;
  asked = true;
  bindWorkspaceSettingsFolder(activeWorkspaceFs, folderRestored);
  // A browser has no shell and no remembered folder.
  if (!desktop()) return;
  // Already connected: a folder picked earlier in this session wins, because
  // reconnecting over it would silently swap where the next write lands.
  if (folderSession()) return markFolderRestored();
  void chooseDesktopFolder({ git: false, reuse: true })
    .catch((err: unknown) => {
      // A path that has gone — an unplugged drive, a dead network share —
      // leaves `activeFs` as it was. Nothing on screen: the reader never
      // asked. The log keeps it for a report.
      logToApp({
        level: "warn",
        source: "workspace",
        message: "The remembered folder could not be reconnected",
        detail: err instanceof Error ? err.message : String(err),
      });
    })
    // Whatever the answer, the readers held for it can go ahead.
    .finally(markFolderRestored);
}
