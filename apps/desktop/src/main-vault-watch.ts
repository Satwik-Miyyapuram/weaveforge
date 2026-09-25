/**
 * Watch the chosen folder, and tell the window when somebody else touches it.
 *
 * Extracted from `main.ts` so the shell's wiring stays apart from the
 * watcher's lifetime. `fs.watch` recursively is supported on Windows and
 * macOS and not on Linux, and there is no third-party watcher in this app's
 * dependencies to fall back to. A platform that cannot watch simply does
 * not, and the folder stays as manual as it was before — the alternative,
 * pulling in a native watcher, is a compiled dependency in an installer for
 * a feature that is a convenience.
 */

import fs from "node:fs";
import path from "node:path";

import type { BrowserWindow } from "electron";

import { safeWorkspacePath } from "@weaveforge/core";

import { CHANNELS } from "./channels";
import { createVaultWatch, type VaultWatch } from "./vault-watch";
import { TEMP_SUFFIX } from "./vault-folder";

/** What the watcher needs from the shell. */
export interface MainVaultWatchDeps {
  /** The window that is told what changed. */
  mainWindow: () => BrowserWindow | null;
}

/** The watcher's door: start it, stop it, and mark the app's own writes. */
export interface MainVaultWatch {
  /** Watch a freshly chosen folder, replacing any watch before it. */
  start(root: string): void;
  /** Stop watching; the folder stays as manual as it was before. */
  stop(): void;
  /** Mark a path as the app's own write, so its echo is folded away. */
  noteSelfWrite(at: string): void;
}

export function registerMainVaultWatch(
  deps: MainVaultWatchDeps,
): MainVaultWatch {
  let vaultWatch: VaultWatch | null = null;
  let vaultWatcher: fs.FSWatcher | null = null;

  function stop(): void {
    vaultWatch?.stop();
    vaultWatch = null;
    vaultWatcher?.close();
    vaultWatcher = null;
  }

  function start(root: string): void {
    stop();
    vaultWatch = createVaultWatch({
      onChange: (paths) =>
        deps.mainWindow()?.webContents.send(CHANNELS.vaultChanged, paths),
      // The same folding the writer does, so a write matches its own echo. A
      // path this refuses is one no write could have produced, and is left as it
      // came: it is somebody else's file either way.
      normalize: (at) => {
        try {
          return safeWorkspacePath(at);
        } catch {
          return at;
        }
      },
    });
    try {
      vaultWatcher = fs.watch(root, { recursive: true }, (_event, name) => {
        if (!name || name.toString().endsWith(TEMP_SUFFIX)) return;
        vaultWatch?.saw(name.toString().split(path.sep).join("/"));
      });
      // A watch that fails later — an unplugged drive — must not take the
      // process with it. The folder is still readable when it comes back.
      vaultWatcher.on("error", () => stop());
    } catch {
      // Recursive watching is unavailable here. Nothing else changes.
      stop();
    }
  }

  return {
    start,
    stop,
    noteSelfWrite: (at) => vaultWatch?.noteSelfWrite(at),
  };
}
