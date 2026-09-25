import { app, dialog, type BrowserWindow } from "electron";

/**
 * Updates the reader is asked about before they run.
 *
 * The older path in `update-check.ts` only ever told the reader a release
 * existed and opened the download page; every update then cost a hand-run
 * installer. That is the part people skip, and a shell that drifts behind the
 * web app it loads is the failure this is meant to prevent. So: check quietly
 * in the background, download in the background, and ask once the bytes are
 * already there.
 *
 * SECURITY: what this file deliberately does *not* do is install without being
 * asked. `autoInstallOnAppQuit` is false, so a downloaded update waits for the
 * reader to choose "Restart now" and an app that is simply quit does not
 * replace itself on the way out. That matters because the Windows build is not
 * code-signed, so the only integrity check on a downloaded update is the
 * SHA-512 in `latest.yml`, which is fetched over HTTPS from the same GitHub
 * release. That is a real check, and it is weaker than a signature: anyone who
 * can serve a forged release over a trusted TLS connection can serve a forged
 * installer with a matching hash. On an unsigned build, turning a forged
 * installer into a running one should cost the reader a click, not their next
 * quit — so quitting is not a consent. The residual risk is bounded by that
 * click and by nothing else, and the real fix is still signing the build; when
 * it is signed, this restriction can be revisited.
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

/**
 * The one question the reader is asked, with the answer it gave.
 *
 * A function rather than `dialog.showMessageBox` inline: the consent this file
 * now exists to obtain is the part worth asserting in a test, and a test cannot
 * put a window on a screen. The real dialog is installed by `main.ts`.
 */
export type AskToInstall = (info: { version: string }) => Promise<boolean>;

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
  /** Injected so the consent question is testable without a window. */
  ask?: AskToInstall;
  /** Whether a found update may be fetched before the reader is asked. */
  autoDownload?: boolean;
  /**
   * What must finish before the installer is handed the process.
   *
   * `quitAndInstall` spawns the installer *first* and quits second, and the
   * NSIS installer gives a running app about two and a half seconds before it
   * `taskkill /f`s it — less than the shutdown needs, which writes the local
   * database out whole and then closes it. A close cut off by the kill is
   * exactly the corruption `will-quit` was written to avoid, so the same
   * shutdown runs here, to completion, before the installer exists at all.
   * Errors are swallowed: an update must not be refused over a backup.
   */
  prepare?: () => Promise<unknown>;
}

/**
 * Start the background update loop. Returns whether it started.
 */
export function startAutoUpdate(options: AutoUpdateOptions): boolean {
  const {
    updater,
    window,
    enabled,
    schedule = setInterval,
    ask = (info) => askInWindow(window, info),
    autoDownload = true,
    prepare = async () => {},
  } = options;
  if (!enabled) return false;

  updater.autoDownload = autoDownload;
  // Never, and not an option. See the SECURITY note at the top of this file:
  // on an unsigned build, quitting the app must not be the act that installs
  // an update nobody agreed to run.
  updater.autoInstallOnAppQuit = false;

  // An update that cannot be reached is not an error the reader needs to see.
  updater.on("error", () => {});

  updater.on("update-downloaded", (info) => {
    void ask(info)
      .then(async (install) => {
        if (!install) return;
        await prepare().catch(() => {});
        updater.quitAndInstall();
      })
      .catch(() => {});
  });

  const look = () => void updater.checkForUpdates().catch(() => {});
  look();
  schedule(look, RECHECK_MS);
  return true;
}

/**
 * The question, in the app's own dialog.
 *
 * `showMessageBox` is used rather than something inside the page because the
 * page is the *web app*: it is served from a server that knows nothing about
 * which shell is asking, and putting this in it would mean browser readers
 * being told to restart an app they do not have.
 *
 * A window that has gone away between the download finishing and the question
 * being asked answers "no". Silence is the safe answer here, and the update is
 * still downloaded and still offered the next time the app opens.
 */
async function askInWindow(
  window: () => BrowserWindow | null,
  info: { version: string },
): Promise<boolean> {
  const target = window();
  if (!target || target.isDestroyed()) return false;
  const { response } = await dialog.showMessageBox(target, {
    type: "info",
    title: "Update ready",
    message: `WeaveForge ${info.version} is ready to install.`,
    detail:
      "It is already downloaded. Restarting takes a few seconds and installs it now. " +
      "If you would rather not stop, choose Later: nothing is installed until you ask.",
    buttons: ["Restart now", "Later"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return response === 0;
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
