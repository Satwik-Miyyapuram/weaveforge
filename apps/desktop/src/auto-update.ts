import { app, dialog, type BrowserWindow } from "electron";

/**
 * Updates that install themselves.
 *
 * The older path in `update-check.ts` only ever told the reader a release
 * existed and opened the download page; every update then cost a hand-run
 * installer. That is the part people skip, and a shell that drifts behind the
 * web app it loads is the failure this is meant to prevent. So: check quietly
 * in the background, download in the background, and install on quit — the
 * reader is asked once, after the bytes are already there, and can say later.
 *
 * Two deliberate limits.
 *
 * SECURITY: the Windows build is not code-signed, so the only integrity check
 * on a downloaded update is the SHA-512 in `latest.yml`, which is fetched over
 * HTTPS from the same GitHub release. That is a real check, and it is weaker
 * than a signature: anyone who can serve a forged release over a trusted TLS
 * connection can serve a forged installer with a matching hash. Signing is the
 * fix, and until it is in place this is what an update is worth.
 *
 * And nothing here runs unless the app is packaged and a feed exists. A
 * development copy has no release to be behind, and an offline copy must not
 * pay for a check it cannot complete: every failure is swallowed, because
 * "could not reach GitHub" is the ordinary state of an app on a train.
 */
export interface Updater {
  /** Fires when a downloaded update is ready to install. */
  on(event: "update-downloaded", handler: (info: { version: string }) => void): void;
  on(event: "error", handler: (error: Error) => void): void;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(silent?: boolean, forceRunAfter?: boolean): void;
}

/** How often an app that stays open looks again. Six hours, not six minutes. */
export const RECHECK_MS = 6 * 60 * 60 * 1000;

export interface AutoUpdateOptions {
  updater: Updater;
  /** The window to ask in, read at the moment of asking rather than captured. */
  window: () => BrowserWindow | null;
  /** Whether checking is allowed at all — false in development. */
  enabled: boolean;
  /** Injected so the schedule is testable without waiting six hours. */
  schedule?: (fn: () => void, ms: number) => void;
}

/**
 * Start the background update loop. Returns whether it started.
 */
export function startAutoUpdate(options: AutoUpdateOptions): boolean {
  const { updater, window, enabled, schedule = setInterval } = options;
  if (!enabled) return false;

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;

  // An update that cannot be reached is not an error the reader needs to see.
  updater.on("error", () => {});

  updater.on("update-downloaded", (info) => {
    const target = window();
    if (!target || target.isDestroyed()) return;
    void dialog
      .showMessageBox(target, {
        type: "info",
        title: "Update ready",
        message: `WeaveForge ${info.version} is ready to install.`,
        detail:
          "It is already downloaded. Restarting takes a few seconds; if you would rather not " +
          "stop now, it installs by itself the next time you quit.",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) updater.quitAndInstall();
      })
      .catch(() => {});
  });

  const look = () => void updater.checkForUpdates().catch(() => {});
  look();
  schedule(look, RECHECK_MS);
  return true;
}

/**
 * The real updater, loaded only when it will be used.
 *
 * `electron-updater` reads the app's version and feed at import time, so a
 * development copy that imports it pays for a module it will never call.
 */
export async function realUpdater(): Promise<Updater | null> {
  if (!app.isPackaged) return null;
  try {
    const { autoUpdater } = await import("electron-updater");
    return autoUpdater as unknown as Updater;
  } catch {
    return null;
  }
}
