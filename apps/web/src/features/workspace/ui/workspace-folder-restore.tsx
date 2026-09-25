"use client";

import { useEffect, useRef } from "react";

import { chooseDesktopFolder, folderSession } from "../application/workspace-folder";
import { desktop } from "@/lib/desktop/desktop-bridge";

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
export function WorkspaceFolderRestore() {
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    // A browser has no shell and no remembered folder.
    if (!desktop()) return;
    // Already connected: a folder picked earlier in this session wins, because
    // reconnecting over it would silently swap where the next write lands.
    if (folderSession()) return;
    void chooseDesktopFolder({ git: false, reuse: true }).catch(() => {
      // A path that has gone — an unplugged drive, a dead network share —
      // leaves `activeFs` as it was. Nothing to report: the reader never asked.
    });
  }, []);

  return null;
}
