import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { handleFetchImage, handleFetchTitle, mayOpenExternally } from "./handlers";
import { CHANNELS, type IpcResult } from "./channels";

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
 * The three channels registered below are the whole of it, and none of them
 * reimplements anything: `handlers.ts` imports `fetch-for-paste` from the web
 * app and hands back what it returns. Same address guard, same size caps, same
 * refusals as the API route a browser would have used.
 */

/**
 * Where the app is served from.
 *
 * A URL rather than a bundled copy of the site, because a bundled copy is a
 * second thing to build, sign, ship and keep in step with the server it talks
 * to anyway — WeaveForge's data lives in Postgres behind an API, so an offline
 * window would be an empty one. Point it at a dev server while developing and
 * at the deployment when packaging.
 */
const APP_URL = process.env.WEAVEFORGE_URL ?? "http://localhost:3000";
const APP_ORIGIN = new URL(APP_URL).origin;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#101014",
    title: "WeaveForge",
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

// Thin on purpose: what these do lives in `handlers.ts`, which the tests can
// reach without an Electron app running.
ipcMain.handle(CHANNELS.fetchTitle, (_event, url: unknown) => handleFetchTitle(url));
ipcMain.handle(CHANNELS.fetchImage, (_event, url: unknown) => handleFetchImage(url));

ipcMain.handle(CHANNELS.openExternal, async (_event, url: unknown): Promise<IpcResult<null>> => {
  if (typeof url !== "string") return { ok: false, message: "That address could not be read." };
  await openExternally(url);
  return { ok: true, value: null };
});

// One window per app, and on macOS the dock icon brings it back rather than
// starting a second copy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [existing] = BrowserWindow.getAllWindows();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  void app.whenReady().then(() => {
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    // macOS keeps the app running with no windows; everywhere else that means
    // the reader is finished.
    if (process.platform !== "darwin") app.quit();
  });
}
