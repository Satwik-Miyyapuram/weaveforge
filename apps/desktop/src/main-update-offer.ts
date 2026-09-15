/**
 * Offer the newer installer.
 *
 * Deliberately not awaited by its callers: the window is already open and
 * usable while this happens, and if GitHub is slow or unreachable the reader
 * never finds out there was a question. `showMessageBox` is used rather than
 * something inside the page because the page is the *web app* — it is served
 * from a server that knows nothing about which shell is asking, and putting
 * this in it would mean browser readers being told to update an app they do
 * not have.
 *
 * It runs on a completed sign-in and nowhere else. Not at launch: an app that
 * opens a dialog every time it opens is an app people learn to dismiss without
 * reading, and the notice would be spent on the launches where nothing has
 * changed. Signing in is the moment the shell's own machinery has just been
 * exercised — the loopback listener, the preload channel that carries the
 * result — so it is both the moment a reader on a stale build most needs to
 * hear it and the moment they are most likely to act. Between sign-ins the
 * same fact is a dot on the Updates section in settings, which is there to be
 * noticed rather than answered.
 *
 * It does not remember having asked: a dismissed dialog does not make a stale
 * shell less stale.
 */

import { app, dialog, type BrowserWindow } from "electron";

import { fetchReleases, findUpdate } from "./update-check";

/** What the offer needs from the shell. */
export interface MainUpdateOfferDeps {
  /** The window the dialog is shown over. */
  mainWindow: () => BrowserWindow | null;
  /** Hands a URL to the operating system, if it is a web address at all. */
  openExternally: (url: string) => Promise<void>;
}

export function registerMainUpdateOffer(
  deps: MainUpdateOfferDeps,
): (options?: { tellWhenCurrent?: boolean }) => Promise<void> {
  let offering = false;

  return async function offerUpdate({
    tellWhenCurrent = false,
  } = {}): Promise<void> {
    // In development the version is whatever is in package.json and the "update"
    // would be the release the source is ahead of.
    if ((!app.isPackaged && !tellWhenCurrent) || offering) return;

    offering = true;
    try {
      const update = await findUpdate({
        currentVersion: app.getVersion(),
        fetchReleases,
      }).catch(() => null);
      // Silence is right for the check on launch and wrong for one the reader
      // asked for: a menu entry that does nothing visible reads as broken.
      if (!update) {
        const window = deps.mainWindow();
        if (tellWhenCurrent && window && !window.isDestroyed()) {
          await dialog.showMessageBox(window, {
            type: "info",
            title: "Up to date",
            message: `WeaveForge ${app.getVersion()} is the newest version.`,
            detail:
              "If you are offline, this only means no newer version could be reached.",
            buttons: ["OK"],
            noLink: true,
          });
        }
        return;
      }

      const window = deps.mainWindow();
      if (!window || window.isDestroyed()) return;
      const { response } = await dialog.showMessageBox(window, {
        type: "info",
        title: "Update available",
        message: `WeaveForge ${update.version} is available.`,
        detail:
          `You are running ${app.getVersion()}. The app itself updates from the web, so this ` +
          "only affects the desktop window — signing in, links, and file handling. " +
          "Downloading opens the release page in your browser.",
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (response === 0) await deps.openExternally(update.url);
    } finally {
      // The guard is against two dialogs at once — a launch check and the
      // sign-in that lands seconds later — not against asking again.
      offering = false;
    }
  };
}
