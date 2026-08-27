import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from "electron";
import fs from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  APP_HOST,
  APP_ORIGIN as BUNDLE_ORIGIN,
  APP_SCHEME,
  appHeaders,
  contentTypeFor,
  resolveAppFile,
} from "./app-protocol";
import type { LocalClient } from "./local-db";
import { LocalDbHost } from "./local-db-host";
import {
  adoptRoot,
  currentRoot,
  forgetRoot,
  listVaultFiles,
  newVaultSession,
  readVaultFile,
  commitVaultFolder,
  removeVaultFile,
  restoreRoot,
  statVaultFile,
  type RememberRoot,
  writeVaultFile,
} from "./vault-handlers";
import { safeWorkspacePath } from "@weaveforge/core";
import { LOCAL_API_HOST, LOCAL_API_PORT, newLocalApiToken, startLocalApi, type LocalApi } from "./local-api-server";
import { fetchZoteroLocal } from "./zotero-local";
import { SecretStore } from "./secret-store";
import { handleOverleafRead } from "./overleaf-source";
import { handleFetchImage, handleFetchTitle, mayOpenExternally } from "./handlers";
import { startAuthLoopback } from "./auth-loopback";
import { CHANNELS } from "./channels";
import { createVaultWatch, type VaultWatch } from "./vault-watch";
import { PreferenceStore } from "./preference-store";
import { fetchReleases, findUpdate } from "./update-check";
import { installMenu, routeTo } from "./app-menu";
import { realUpdater, startAutoUpdate } from "./auto-update";

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

/** The static build, if this shell was packaged with one. See `app-protocol.ts`. */
const BUNDLE = path.join(__dirname, "web");
const bundled = fs.existsSync(path.join(BUNDLE, "index.html"));

/**
 * A bundled app is served from `app://`; without one the window falls back to
 * the deployment, which is what a shell built before the offline work did. The
 * environment variable still wins over both, because pointing the window at a
 * dev server is how this is developed.
 */
const APP_URL =
  process.env.WEAVEFORGE_URL ?? (bundled ? `${BUNDLE_ORIGIN}/` : __DEFAULT_APP_URL__);
const APP_ORIGIN = new URL(APP_URL).origin;

/** Where the Help menu sends a reader. Matches the app's own docs link. */
const DOCS_URL = "https://www.weaveforge.org/docs/";

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

async function offerUpdate({ tellWhenCurrent = false } = {}): Promise<void> {
  // In development the version is whatever is in package.json and the "update"
  // would be the release the source is ahead of.
  if ((!app.isPackaged && !tellWhenCurrent) || offering) return;

  offering = true;
  try {
    const update = await findUpdate({ currentVersion: app.getVersion(), fetchReleases }).catch(() => null);
    // Silence is right for the check on launch and wrong for one the reader
    // asked for: a menu entry that does nothing visible reads as broken.
    if (!update) {
      if (tellWhenCurrent && mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Up to date",
          message: `WeaveForge ${app.getVersion()} is the newest version.`,
          detail: "If you are offline, this only means no newer version could be reached.",
          buttons: ["OK"],
          noLink: true,
        });
      }
      return;
    }

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
/**
 * The shell's settings file, opened on each call.
 *
 * A factory rather than a value because `getPath` needs an app that is ready,
 * and this module is evaluated before that. Reading the file per call also
 * means a second window — or a second instance that lost the lock race — never
 * writes back a copy it read minutes ago.
 */
function preferenceStore(): PreferenceStore {
  const file = path.join(app.getPath("userData"), "preferences.json");
  return new PreferenceStore({
    read: () => fs.promises.readFile(file, "utf8").catch(() => null),
    write: (contents) => fs.promises.writeFile(file, contents, "utf8"),
  });
}

ipcMain.handle(CHANNELS.preferenceRead, (_event, name: unknown) => preferenceStore().read(name));
ipcMain.handle(CHANNELS.preferenceWrite, (_event, name: unknown, value: unknown) =>
  preferenceStore().write(name, value),
);

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
 * Declares `app://` a real origin.
 *
 * Must happen before the app is ready — the flags are read when the renderer
 * process starts, not when the handler is registered. `standard` is what gives
 * the scheme an origin at all, and `secure` is what puts that origin in the
 * same bucket as `https` for the storage APIs and the service worker.
 */
if (bundled) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/**
 * Answers `app://` requests out of the bundle.
 *
 * A request for something the bundle does not have is a 404 rather than a
 * thrown error: the renderer asks for plenty of things optionally, and a
 * protocol handler that throws turns each of those into a console error with
 * no useful text in it.
 */
function serveBundle(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    if (new URL(request.url).hostname !== APP_HOST) return new Response(null, { status: 404 });

    const file = resolveAppFile(BUNDLE, request.url, (candidate) => fs.existsSync(candidate));
    if (!file) return new Response(null, { status: 404 });

    const response = await net.fetch(pathToFileURL(file).toString());
    return new Response(response.body, {
      status: response.status,
      headers: appHeaders(contentTypeFor(file)),
    });
  });
}

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

ipcMain.handle(CHANNELS.overleafRead, (_event, projectId: unknown, entryFile: unknown) =>
  handleOverleafRead(projectId, entryFile, () => secretStore().read("overleaf-token")),
);

/**
 * The local database, opened on first use under the app's own directory.
 *
 * PGlite is imported here and nowhere else, and lazily: it is a WASM Postgres,
 * and an app that stays online for its whole life should never pay to load it.
 */
const localDb = new LocalDbHost({
  migrations: [path.join(__dirname, "migrations"), path.join(__dirname, "migrations-local")],
  open: async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
    const dataDir = path.join(app.getPath("userData"), "local-db");
    return (await PGlite.create({ dataDir, extensions: { pgcrypto } })) as unknown as LocalClient;
  },
});

ipcMain.handle(CHANNELS.dbQuery, (_event, sql: unknown, params: unknown) =>
  localDb.query(sql, params),
);

/**
 * The workspace folder.
 *
 * The renderer never names a directory: `vaultChoose` opens a picker and the
 * chosen path stays in this process, so every later read and write is relative
 * to something a person selected in a dialog. That is the whole reason the
 * session lives here rather than being passed in on each call.
 */
const vault = newVaultSession();

/** The chosen folder outlives the process, so the app comes back to it. */
const rememberRoot: RememberRoot = (root) => {
  void preferenceStore().write("vault-root", root);
};

/**
 * Take up last run's folder, re-verified. Deliberately not awaited at startup:
 * the window should not wait on a disk that may be a disconnected network
 * share, and the renderer asks for the root when it needs it anyway.
 */
void preferenceStore()
  .read("vault-root")
  .then((result) => (result.ok ? restoreRoot(vault, result.value, rememberRoot) : null))
  .then((root) => (root ? startWatchingVault(root.path) : null))
  .catch(() => null);

/**
 * Ask for a workspace folder and adopt what comes back.
 *
 * Its own function because two things ask: the renderer, through the bridge,
 * and the File menu. A menu entry that reimplemented the adoption would be a
 * second answer to "what happens to a folder that already has notes in it".
 */
async function chooseWorkspaceFolder() {
  const window = mainWindow;
  const result = window
    ? await dialog.showOpenDialog(window, {
        title: "Choose a folder for your workspace",
        properties: ["openDirectory", "createDirectory"],
      })
    : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  // A dismissed dialog is the user declining, not a failure.
  const adopted = await adoptRoot(
    vault,
    result.canceled ? null : (result.filePaths[0] ?? null),
    rememberRoot,
  );
  if (adopted.ok && adopted.value) startWatchingVault(adopted.value.path);
  return adopted;
}

ipcMain.handle(CHANNELS.vaultChoose, () => chooseWorkspaceFolder());

ipcMain.handle(CHANNELS.vaultRoot, () => currentRoot(vault));
ipcMain.handle(CHANNELS.vaultForget, () => {
  stopWatchingVault();
  return forgetRoot(vault, rememberRoot);
});
ipcMain.handle(CHANNELS.vaultRead, (_event, at: unknown) => readVaultFile(vault, at));
ipcMain.handle(CHANNELS.vaultWrite, async (_event, at: unknown, contents: unknown) => {
  // Said before the write rather than after: the filesystem event can arrive
  // while the write is still returning, and an echo that beats its own note
  // would be reported as somebody else's change.
  if (typeof at === "string") vaultWatch?.noteSelfWrite(at);
  return writeVaultFile(vault, at, contents);
});
ipcMain.handle(CHANNELS.vaultList, (_event, at: unknown) => listVaultFiles(vault, at));
ipcMain.handle(CHANNELS.vaultStat, (_event, at: unknown) => statVaultFile(vault, at));
ipcMain.handle(CHANNELS.vaultRemove, async (_event, at: unknown) => {
  if (typeof at === "string") vaultWatch?.noteSelfWrite(at);
  return removeVaultFile(vault, at);
});
/**
 * The local HTTP surface, off until somebody switches it on.
 *
 * The token is read from the keychain per request rather than held here, so
 * revoking it takes effect immediately, and a token that was never generated
 * reads as an empty string -- which `routeLocalRequest` refuses outright.
 */
let localApi: LocalApi | null = null;

async function localApiToken(): Promise<string> {
  const stored = await secretStore().read("local-api-token");
  return stored.ok && stored.value ? stored.value : "";
}

const LOCAL_API_URL = `http://${LOCAL_API_HOST}:${LOCAL_API_PORT}`;

async function startLocalApiIfEnabled(): Promise<string | undefined> {
  if (localApi) return undefined;
  try {
    localApi = await startLocalApi(vault, () => cachedToken, (sql, params) =>
      localDb.query(sql, params),
    );
    return undefined;
  } catch (error) {
    // The usual reason is another program on the port -- Obsidian's own REST
    // plugin, most likely. Reported rather than retried: two things answering
    // on one port is not something to resolve behind the user's back.
    return error instanceof Error ? error.message : "The port is not available.";
  }
}

/** Read once per start and per token change, because a socket cannot await. */
let cachedToken = "";

async function resumeLocalApi(): Promise<void> {
  const enabled = await preferenceStore().read("local-api");
  if (!enabled.ok || enabled.value !== true) return;
  cachedToken = await localApiToken();
  if (!cachedToken) return;
  await startLocalApiIfEnabled();
}

ipcMain.handle(CHANNELS.localApiState, async () => {
  const enabled = await preferenceStore().read("local-api");
  return {
    ok: true,
    value: { enabled: localApi !== null && enabled.ok && enabled.value === true, url: LOCAL_API_URL },
  };
});

ipcMain.handle(CHANNELS.localApiSet, async (_event, enabled: unknown) => {
  if (enabled !== true) {
    await preferenceStore().write("local-api", false);
    await secretStore().clear("local-api-token");
    cachedToken = "";
    await localApi?.close();
    localApi = null;
    return { ok: true, value: { enabled: false, url: LOCAL_API_URL } };
  }

  // A new token every time it is switched on. Reusing the old one would mean
  // that switching the door off and on again leaves the same keys working.
  const token = newLocalApiToken();
  const kept = await secretStore().write("local-api-token", token);
  if (!kept.ok) return { ok: false, message: kept.message };
  cachedToken = token;
  await preferenceStore().write("local-api", true);
  const reason = await startLocalApiIfEnabled();
  return {
    ok: true,
    value: { enabled: localApi !== null, url: LOCAL_API_URL, token, ...(reason ? { reason } : {}) },
  };
});

ipcMain.handle(CHANNELS.zoteroLocal, async (_event, url: unknown) => {
  try {
    return { ok: true, value: await fetchZoteroLocal(url) };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Zotero on this computer did not answer. Is it running?",
    };
  }
});

ipcMain.handle(CHANNELS.vaultCommit, async () => {
  // The setting is read here rather than sent by the renderer: a window that
  // could pass its own `true` would be switching folder history on without
  // anybody having chosen it.
  const enabled = await preferenceStore().read("vault-git");
  return commitVaultFolder(vault, enabled.ok && enabled.value === true);
});

/**
 * Watch the chosen folder, and tell the window when somebody else touches it.
 *
 * `fs.watch` recursively is supported on Windows and macOS and not on Linux,
 * and there is no third-party watcher in this app's dependencies to fall back
 * to. A platform that cannot watch simply does not, and the folder stays as
 * manual as it was before -- the alternative, pulling in a native watcher, is
 * a compiled dependency in an installer for a feature that is a convenience.
 */
let vaultWatch: VaultWatch | null = null;
let vaultWatcher: fs.FSWatcher | null = null;

function stopWatchingVault(): void {
  vaultWatch?.stop();
  vaultWatch = null;
  vaultWatcher?.close();
  vaultWatcher = null;
}

function startWatchingVault(root: string): void {
  stopWatchingVault();
  vaultWatch = createVaultWatch({
    onChange: (paths) => mainWindow?.webContents.send(CHANNELS.vaultChanged, paths),
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
      if (!name) return;
      vaultWatch?.saw(name.toString().split(path.sep).join("/"));
    });
    // A watch that fails later -- an unplugged drive -- must not take the
    // process with it. The folder is still readable when it comes back.
    vaultWatcher.on("error", () => stopWatchingVault());
  } catch {
    // Recursive watching is unavailable here. Nothing else changes.
    stopWatchingVault();
  }
}

app.on("will-quit", (event) => {
  event.preventDefault();
  void localDb.close().finally(() => app.exit(0));
});

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
    if (bundled) serveBundle();
    // Started before the window, so a sign-in cannot come back to a port that
    // is not listening yet.
    loopback = startAuthLoopback(deliverSignIn);
    // Taken back up only if it was switched on and there is still a token to
    // present. A door left open in the settings with its key thrown away
    // stays shut.
    void resumeLocalApi();
    createWindow();
    // Updates install themselves when they can; the older check-and-tell path
    // stays for the menu entry and for builds with no feed behind them.
    void realUpdater().then((updater) => {
      if (updater) startAutoUpdate({ updater, window: () => mainWindow, enabled: true });
    });
    installMenu({
      chooseFolder: async () => {
        await chooseWorkspaceFolder();
      },
      checkForUpdates: () => offerUpdate({ tellWhenCurrent: true }),
      docsUrl: DOCS_URL,
      goTo: (route) => routeTo(mainWindow, APP_URL, route),
    });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("will-quit", () => {
    loopback?.close();
    loopback = null;
    void localApi?.close();
    localApi = null;
  });

  app.on("window-all-closed", () => {
    // macOS keeps the app running with no windows; everywhere else that means
    // the reader is finished.
    if (process.platform !== "darwin") app.quit();
  });
}
