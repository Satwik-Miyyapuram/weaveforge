import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SecretStore } from "./secret-store";
import { handleFetchImage, handleFetchTitle, mayOpenExternally } from "./handlers";
import { startAuthLoopback } from "./auth-loopback";
import { CHANNELS } from "./channels";
import { fetchReleases, findUpdate } from "./update-check";

/**
 * The desktop shell.
 *
 * There is no second copy of the app in here. The window loads the WeaveForge
 * web app — the same Next.js build a browser gets — and this process adds only
 * what a browser genuinely cannot do. Everything the renderer sees is behind
 * `window.weaveforge`, a small interface with a browser implementation beside
 * it in `apps/web/src/lib/outbound-fetch.ts`, so no feature is desktop-only and
 * no feature is written twice.
 *
 * The two request channels registered below reimplement nothing: `handlers.ts`
 * imports `fetch-for-paste` from the web app and hands back what it returns.
 * Same address guard, same size caps, same refusals as the API route a browser
 * would have used. The third channel goes the other way — it carries a finished
 * sign-in in from the loopback listener, which is the one thing a page has no
 * way to receive on its own.
 *
 * Opening a link elsewhere is deliberately *not* among them. The window already
 * sends off-origin navigations to the real browser below, which covers what a
 * page can do about it, so a channel for the page to ask directly would be a
 * third hole in the sandbox that nothing was calling.
 */

/**
 * Where the app is served from.
 *
 * A URL rather than a bundled copy of the site, because a bundled copy is a
 * second thing to build, sign, ship and keep in step with the server it talks
 * to anyway — WeaveForge's data lives in Postgres behind an API, so an offline
 * window would be an empty one. Point it at a dev server while developing and
 * at the deployment when packaging.
 *
 * `WEAVEFORGE_URL` set at launch wins. Set at *build* time it becomes the
 * default baked into the bundle, which is the one that matters for an
 * installed app: a packaged window is started from a shortcut, and a shortcut
 * has no shell to inherit an environment from.
 */
declare const __DEFAULT_APP_URL__: string;

const APP_URL = process.env.WEAVEFORGE_URL ?? __DEFAULT_APP_URL__;
const APP_ORIGIN = new URL(APP_URL).origin;

let mainWindow: BrowserWindow | null = null;
let loopback: import("node:http").Server | null = null;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#101014",
    title: "WeaveForge",
    // Beside the bundle in `dist/`; see `scripts/build.mjs`. Set here because
    // stamping it into the executable needs a toolchain that cannot be
    // unpacked on Windows without the symlink privilege.
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      // Both files land beside each other in `dist/`; see `scripts/build.mjs`.
      preload: path.join(__dirname, "preload.js"),
      // The three that matter, all at their safe settings. The renderer is a
      // web page from a server; it gets no Node, no shared globals with the
      // preload, and its own sandbox. Everything it may ask this process to do
      // is one of the channels below, and nothing else.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  void window.loadURL(APP_URL);

  /**
   * A link to somewhere else opens in the reader's real browser.
   *
   * Both halves are needed and they cover different things: `will-navigate` is
   * the current window following a link, and the open handler is `target=_blank`
   * and `window.open`. Without them a page can navigate the shell itself to an
   * arbitrary site, and that site would then be a page with a preload attached.
   */
  window.webContents.on("will-navigate", (event, url) => {
    if (sameOrigin(url)) return;
    event.preventDefault();
    void openExternally(url);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternally(url);
    return { action: "deny" };
  });
}

/**
 * Whether a navigation is staying inside the app.
 *
 * Anything unparseable counts as "no" and is refused: a URL this cannot read is
 * not one the shell should follow, and `openExternally` will not open it either.
 */
function sameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

/** Hands a URL to the operating system, if it is a web address at all. */
async function openExternally(url: string): Promise<void> {
  if (!mayOpenExternally(url)) return;
  await shell.openExternal(url);
}

/**
 * Hands a finished sign-in to the page that started it.
 *
 * The query string is passed along as it arrived and is not read here. What is
 * in it is an authorization code, and a code is only worth anything together
 * with the PKCE verifier that was generated when the flow started — which lives
 * in the renderer and has never left it. So the renderer is the only part of
 * this that can finish the exchange, and the only part that needs to.
 */
function deliverSignIn(query: string): void {
  if (!mainWindow) createWindow();
  const window = mainWindow;
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
  window.webContents.send(CHANNELS.signIn, query);
  void offerUpdate();
}

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
let offering = false;

async function offerUpdate(): Promise<void> {
  // In development the version is whatever is in package.json and the "update"
  // would be the release the source is ahead of.
  if (!app.isPackaged || offering) return;

  offering = true;
  try {
    const update = await findUpdate({ currentVersion: app.getVersion(), fetchReleases });
    if (!update) return;

    const window = mainWindow;
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
    if (response === 0) await openExternally(update.url);
  } finally {
    // The guard is against two dialogs at once — a launch check and the
    // sign-in that lands seconds later — not against asking again.
    offering = false;
  }
}

// Thin on purpose: what these do lives in `handlers.ts`, which the tests can
// reach without an Electron app running.
ipcMain.handle(CHANNELS.fetchTitle, (_event, url: unknown) => handleFetchTitle(url));
ipcMain.handle(CHANNELS.fetchImage, (_event, url: unknown) => handleFetchImage(url));
// The settings panel asking, rather than the shell announcing. A failure is
// null and not an error: a settings section that cannot reach GitHub should
// say it does not know, not turn red.
ipcMain.handle(CHANNELS.checkUpdate, async () => {
  if (!app.isPackaged) return null;
  return findUpdate({ currentVersion: app.getVersion(), fetchReleases });
});

/**
 * The keychain, wired to `safeStorage` and one file in the app's own data
 * directory.
 *
 * The path is resolved lazily rather than at module load: `getPath` needs a
 * ready app, and this module is evaluated before `whenReady`. Nothing readable
 * is written — see `secret-store.ts` for what the file contains and what
 * happens on a machine with no keychain backend.
 */
function secretStore(): SecretStore {
  const file = path.join(app.getPath("userData"), "secrets.json");
  return new SecretStore(safeStorage, {
    read: () => readFile(file, "utf8").catch(() => null),
    write: (contents) => writeFile(file, contents, { encoding: "utf8", mode: 0o600 }),
  });
}

ipcMain.handle(CHANNELS.secretRead, (_event, name: unknown) => secretStore().read(name));
ipcMain.handle(CHANNELS.secretWrite, (_event, name: unknown, value: unknown) =>
  secretStore().write(name, value),
);
ipcMain.handle(CHANNELS.secretClear, (_event, name: unknown) => secretStore().clear(name));

// One window per app, and on macOS the dock icon brings it back rather than
// starting a second copy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second launch raises the window that is already open rather than
  // starting another copy of the app.
  app.on("second-instance", () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (!existing) return;
    if (existing.isMinimized()) existing.restore();
    existing.focus();
  });

  void app.whenReady().then(() => {
    // Started before the window, so a sign-in cannot come back to a port that
    // is not listening yet.
    loopback = startAuthLoopback(deliverSignIn);
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("will-quit", () => {
    loopback?.close();
    loopback = null;
  });

  app.on("window-all-closed", () => {
    // macOS keeps the app running with no windows; everywhere else that means
    // the reader is finished.
    if (process.platform !== "darwin") app.quit();
  });
}
