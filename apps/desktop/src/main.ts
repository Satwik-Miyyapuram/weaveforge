import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  APP_HOST,
  APP_ORIGIN as BUNDLE_ORIGIN,
  APP_SCHEME,
  appHeaders,
  contentTypeFor,
  isPageRequest,
  resolveAppFile,
} from "./app-protocol";
import { readHomeConfig, writeHomeConfig } from "./home-config";
import {
  chooseRoot,
  currentRoot,
  forgetRoot,
  listVaultFiles,
  newVaultSession,
  readVaultBytes,
  readVaultFile,
  commitVaultFolder,
  removeVaultFile,
  restoreRoot,
  statVaultFile,
  type RememberRoot,
  writeVaultBytes,
  writeVaultFile,
} from "./vault-handlers";
import { registerMainAppLog } from "./main-app-log";
import { registerMainInk } from "./main-ink";
import { applyMemorySwitches, registerMemoryTrimming } from "./memory-trim";
import { registerMainLocalDb } from "./main-local-db";
import { registerMainLocalApi } from "./main-local-api";
import { registerMainUpdateOffer } from "./main-update-offer";
import { registerMainVaultWatch } from "./main-vault-watch";
import { fetchZoteroLocal } from "./zotero-local";
import { probeTex } from "./tex";
import { registerMainTex } from "./main-tex";
import { MODEL_HOST, serveModelFile } from "./model-cache";
import { handleOverleafRead } from "./overleaf-source";
import {
  handleFetchImage,
  handleFetchTitle,
  mayOpenExternally,
} from "./handlers";
import { answerRelay } from "./app-relays";
import { installApiCors } from "./api-cors";
import { startAuthLoopback } from "./auth-loopback";
import { CHANNELS, type IpcResult, type MenuGroupPayload } from "./channels";
import { preferenceStore, secretStore } from "./main-stores";
import { fetchReleases, findUpdate } from "./update-check";
import { installMenu, invokeMenuItem, menuModel, pageCommand, routeTo } from "./app-menu";
import { realUpdater, startAutoUpdate } from "./auto-update";
import { originOf, registerGuardedIpc, sameOrigin } from "./ipc-guard";
import { runBoundedQuit } from "./quit";
import { createAppLog, type AppLog } from "./app-log";

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
  process.env.WEAVEFORGE_URL ??
  (bundled ? `${BUNDLE_ORIGIN}/` : __DEFAULT_APP_URL__);
const APP_ORIGIN = originOf(APP_URL);

/**
 * The only way a channel is registered, and the reason it is not `ipcMain`.
 *
 * The window is supposed to be the app and nothing else, and the navigation
 * guard below is what keeps it that way. Two supported configurations step
 * around that guard rather than through it: `WEAVEFORGE_URL` points the window
 * at whatever a developer says, and a packaged shell's `__DEFAULT_APP_URL__` is
 * whatever its build was stamped with -- including a plain-HTTP origin. In
 * either case every channel below would happily answer a page that is not ours,
 * and those channels include raw SQL, the workspace folder, the keychain and
 * the switch that opens the loopback API. So the origin is checked on every
 * call at the boundary itself; `ipc-guard.ts` has the reasoning and the rule.
 */
const ipc = registerGuardedIpc(APP_ORIGIN, ipcMain);

/**
 * The application log, and the two lines of setup it needs.
 *
 * Created here rather than inside `whenReady` so the console is captured from
 * the first line this process prints: the failures worth having on disk are the
 * ones that happen while the shell is still coming up. `record` needs no ready
 * app — only `file` does, and that is read lazily when the page asks.
 *
 * The `dir` is resolved per call because `app.getPath("userData")` is only
 * valid once Electron has a name for the app, which happens after this module
 * is evaluated — so `createAppLog` is handed a function to call rather than the
 * path itself.
 */
const appLog: AppLog = createAppLog({ dir: () => app.getPath("userData") });
appLog.installConsoleCapture();
// The file is the record and the ring is a window onto it: on a fresh launch
// that window starts empty, so the panel would say "nothing has been logged"
// while the previous session's failures sat in the file beside it — which is
// exactly the session a reader is asking about when the window died. The read
// cannot happen at module load (`getPath` needs a ready app), so it is kicked
// off here and awaited by nobody: a log that has not finished restoring is a
// log with fewer lines, not a launch that waits on a disk.
//
// The catch is not decoration. This file installs an `unhandledRejection`
// listener a few lines below that records the reason *and leaves the process
// running*, so a rejection here would be a line in the log rather than a crash —
// but it would also be the one failure this whole feature exists to make
// legible, and it would be legible only as "unhandledRejection". The read is
// allowed to fail; it is not allowed to fail silently.
void app.whenReady().then(() =>
  appLog.restoreFromDisk().catch((cause: unknown) => {
    appLog.record({
      level: "warn",
      source: "app-log",
      message: "the previous session's log could not be read back",
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }),
);

/**
 * One record, for a failure nobody else is going to print.
 *
 * The caller is `unhandledRejection` below; this is shared rather than inlined
 * so the shape of a fatal entry is stated once.
 */
function recordFatal(what: string, cause: unknown): void {
  appLog.record({
    level: "error",
    source: "uncaught",
    message: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
    detail: what,
  });
}

/**
 * An unhandled rejection is recorded, because nothing else will print it.
 *
 * There is deliberately **no** `uncaughtException` listener here, and the two
 * were the same thing for a while. Registering one suppresses Node's default
 * action — print the error and exit — so a shell that would have died on a
 * crash instead carried on in an undefined state that the reader has no way to
 * see. That is a worse outcome than the lost log line it bought, and the log
 * line was not even reliably bought: `flush()` is an unbounded promise chain,
 * so `void`-ing it here waited for nothing while the process was free to exit
 * with the write still queued.
 *
 * What survives of the original idea is the console capture above: an uncaught
 * exception is still printed by Node, that print still reaches the log through
 * the wrapped console, and the process still dies the way it should. A
 * rejection is different — it is printed by nobody unless it is listened for —
 * so this one stays, and it only records.
 */
process.on("unhandledRejection", (reason) => {
  recordFatal("unhandledRejection", reason);
});

/** Where the Help menu sends a reader. Matches the app's own docs link. */
const DOCS_URL = "https://www.weaveforge.org/docs/";

let mainWindow: BrowserWindow | null = null;
let loopback: import("node:http").Server | null = null;

applyMemorySwitches();

/**
 * Windows and Linux: no system title bar, so the page can draw its own with the
 * menu in it (`components/desktop-title-bar.tsx`). The minimise, maximise and
 * close buttons stay the system's, drawn over the right-hand end at the same
 * height as the page's bar. macOS keeps its own title bar and menu.
 */
const CUSTOM_TITLE_BAR = process.platform !== "darwin";
const TITLE_BAR_HEIGHT = 36;

function createWindow(): void {
  const window = new BrowserWindow({
    ...(CUSTOM_TITLE_BAR
      ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: { color: "#101014", symbolColor: "#e8e6f0", height: TITLE_BAR_HEIGHT },
        }
      : {}),
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
  registerMemoryTrimming(window);
  // "Maximize" reads "Restore" once it has been, so the page's menu is stale.
  window.on("maximize", () => window.webContents.send(CHANNELS.menuChanged));
  window.on("unmaximize", () => window.webContents.send(CHANNELS.menuChanged));

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
    // The same question the IPC guard asks, from the same helper: one answer to
    // "is this the app" for the navigation and for the bridge it would expose.
    if (sameOrigin(url, APP_ORIGIN)) return;
    event.preventDefault();
    void openExternally(url);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternally(url);
    return { action: "deny" };
  });
}

/** Hands a URL to the operating system, if it is a web address at all. */
async function openExternally(url: string): Promise<void> {
  if (!mayOpenExternally(url)) return;
  await shell.openExternal(url);
}

/**
 * The newer-installer offer (§main-update-offer): shown over the window on a
 * completed sign-in, silent everywhere else.
 */
const offerUpdate = registerMainUpdateOffer({
  mainWindow: () => mainWindow,
  openExternally,
});

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

// Thin on purpose: what these do lives in `handlers.ts`, which the tests can
// reach without an Electron app running.
ipc.on(CHANNELS.windowFocus, (_event, on: unknown) => {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  const focus = on === true;
  // The menu bar is hidden rather than removed: the accelerators on it (the
  // chord that leaves focus mode among them) keep working while it is away.
  window.setMenuBarVisibility(!focus);
  window.setFullScreen(focus);
});

ipc.handle(CHANNELS.menuModel, (): IpcResult<MenuGroupPayload[] | null> => ({
  ok: true,
  value: CUSTOM_TITLE_BAR ? menuModel(mainWindow) : null,
}));
ipc.handle(CHANNELS.menuInvoke, (_event, id: unknown): IpcResult<null> =>
  invokeMenuItem(id, mainWindow) ? { ok: true, value: null } : { ok: false, message: "That menu entry is not available." },
);
ipc.on(CHANNELS.titleBarColors, (_event, colors: unknown) => {
  const window = mainWindow;
  if (!CUSTOM_TITLE_BAR || !window || window.isDestroyed()) return;
  const { background, ink } = (colors ?? {}) as { background?: unknown; ink?: unknown };
  const hex = (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  if (!hex(background) || !hex(ink)) return;
  window.setTitleBarOverlay({ color: background as string, symbolColor: ink as string, height: TITLE_BAR_HEIGHT });
});

/** The application log's channels (§main-app-log). */
registerMainAppLog({ ipc, appLog });

ipc.handle(CHANNELS.preferenceRead, (_event, name: unknown) =>
  preferenceStore().read(name),
);
ipc.handle(CHANNELS.preferenceWrite, (_event, name: unknown, value: unknown) =>
  preferenceStore().write(name, value),
);

ipc.handle(CHANNELS.fetchTitle, (_event, url: unknown) =>
  handleFetchTitle(url),
);
ipc.handle(CHANNELS.fetchImage, (_event, url: unknown) =>
  handleFetchImage(url),
);
// The settings panel asking, rather than the shell announcing. A failure is
// null and not an error: a settings section that cannot reach GitHub should
// say it does not know, not turn red.
ipc.handle(CHANNELS.checkUpdate, async () => {
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
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
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
    const host = new URL(request.url).hostname;
    // `app://models/...` is the encoder's weights, cached on the disk so the
    // feature keeps working with the network unplugged.
    if (host === MODEL_HOST) {
      return serveModelFile(
        path.join(app.getPath("userData"), "models"),
        request.url,
      );
    }
    if (host !== APP_HOST) return new Response(null, { status: 404 });
    // The `/api/*` routes the web app has on a server, relayed by the shell.
    const relayed = answerRelay(request, net.fetch);
    if (relayed) return relayed;

    // A file, not merely a path: `/reader` names the `reader/` folder before
    // it names `reader/index.html`, and a folder handed to net.fetch throws.
    const file = resolveAppFile(BUNDLE, request.url, (candidate) =>
      fs.statSync(candidate, { throwIfNoEntry: false })?.isFile() ?? false,
    );
    const notFound = path.join(BUNDLE, "404.html");
    const served =
      file ??
      (isPageRequest(request.url) && fs.existsSync(notFound) ? notFound : null);
    if (!served) return new Response(null, { status: 404 });

    const response = await net.fetch(pathToFileURL(served).toString());
    return new Response(response.body, {
      status: file ? response.status : 404,
      headers: appHeaders(contentTypeFor(served)),
    });
  });
}

ipc.handle(CHANNELS.secretRead, (_event, name: unknown) =>
  secretStore().read(name),
);
ipc.handle(CHANNELS.secretWrite, (_event, name: unknown, value: unknown) =>
  secretStore().write(name, value),
);
ipc.handle(CHANNELS.secretClear, (_event, name: unknown) =>
  secretStore().clear(name),
);

ipc.handle(
  CHANNELS.overleafRead,
  (_event, projectId: unknown, entryFile: unknown) =>
    handleOverleafRead(projectId, entryFile, () =>
      secretStore().read("overleaf-token"),
    ),
);

/** The local database (§main-local-db). */
const { localDb, shutDownLocalDb } = registerMainLocalDb({
  ipc,
  workspaceRoot: () => vault.root?.path,
  rootRestored: () => rootRestored,
});

/**
 * The workspace folder.
 *
 * The renderer never names a directory: `vaultChoose` opens a picker and the
 * chosen path stays in this process, so every later read and write is relative
 * to something a person selected in a dialog. That is the whole reason the
 * session lives here rather than being passed in on each call.
 */
const vault = newVaultSession();

/**
 * The folder's watcher (§main-vault-watch): tells the window when somebody
 * else touches the chosen folder, and folds the app's own writes away.
 */
const vaultWatcher = registerMainVaultWatch({
  mainWindow: () => mainWindow,
});

/**
 * The chosen folder outlives the process, so the app comes back to it -- and
 * outlives the app's directory too (`home-config.ts`), so a reinstall does.
 */
const rememberRoot: RememberRoot = (root) => {
  void preferenceStore().write("vault-root", root);
  void writeHomeConfig(app.getPath("home"), { vaultRoot: root });
};

/**
 * Take up last run's folder, re-verified. Deliberately not awaited at startup:
 * the window should not wait on a disk that may be a disconnected network
 * share, and the renderer asks for the root when it needs it anyway. Only the
 * database open waits for it (it wants the folder's backups), and that is
 * lazy too.
 *
 * The preference first; the home config only when there is none, which is
 * what a fresh install looks like.
 */
const rootRestored: Promise<void> = preferenceStore()
  .read("vault-root")
  .then(async (result) => {
    if (result.ok && typeof result.value === "string" && result.value) return result.value;
    return (await readHomeConfig(app.getPath("home"))).vaultRoot;
  })
  .then((remembered) => restoreRoot(vault, remembered, rememberRoot))
  .then((root) => {
    // A folder remembered from the last run is a connected folder from this one,
    // so the menu says so before the window is even shown.
    if (root) vaultWatcher.start(root.path);
    // The menu was first drawn before this finished, saying "Choose workspace
    // folder…"; draw it again now the folder is known.
    void app.whenReady().then(refreshMenu);
  })
  .catch(() => null)
  .then(() => undefined);

/**
 * Put the workspace folder in the menu, whatever it is now.
 *
 * Called at startup, when a folder is chosen, and when one is forgotten: the
 * menu is a picture of the state, and a picture drawn once is how the File menu
 * went on saying "Choose workspace folder…" after a folder was connected.
 */
function refreshMenu(): void {
  installMenu({
    chooseFolder: async () => {
      await chooseWorkspaceFolder();
    },
    workspace: () => vault.root?.path ?? null,
    openFolder: async () => {
      const root = vault.root?.path;
      if (root) await shell.openPath(root);
    },
    checkForUpdates: () => offerUpdate({ tellWhenCurrent: true }),
    docsUrl: DOCS_URL,
    goTo: (route) => routeTo(mainWindow, APP_URL, route),
    search: () => pageCommand(mainWindow, "search"),
  });
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(CHANNELS.menuChanged);
}

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
    : await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
      });
  // A dismissed dialog is the user declining, not a failure.
  const adopted = await chooseRoot(
    vault,
    result.canceled ? null : (result.filePaths[0] ?? null),
    rememberRoot,
  );
  if (adopted.ok && adopted.value) vaultWatcher.start(adopted.value.path);
  refreshMenu();
  return adopted;
}

ipc.handle(CHANNELS.vaultChoose, () => chooseWorkspaceFolder());

ipc.handle(CHANNELS.vaultRoot, () => currentRoot(vault));
ipc.handle(CHANNELS.vaultForget, () => {
  vaultWatcher.stop();
  const forgotten = forgetRoot(vault, rememberRoot);
  refreshMenu();
  return forgotten;
});
ipc.handle(CHANNELS.vaultRead, (_event, at: unknown) =>
  readVaultFile(vault, at),
);
ipc.handle(
  CHANNELS.vaultWrite,
  async (_event, at: unknown, contents: unknown) => {
    // Said before the write rather than after: the filesystem event can arrive
    // while the write is still returning, and an echo that beats its own note
    // would be reported as somebody else's change.
    if (typeof at === "string") vaultWatcher.noteSelfWrite(at);
    return writeVaultFile(vault, at, contents);
  },
);
ipc.handle(CHANNELS.vaultReadBytes, (_event, at: unknown) =>
  readVaultBytes(vault, at),
);
ipc.handle(
  CHANNELS.vaultWriteBytes,
  async (_event, at: unknown, bytes: unknown) => {
    if (typeof at === "string") vaultWatcher.noteSelfWrite(at);
    return writeVaultBytes(vault, at, bytes);
  },
);
ipc.handle(CHANNELS.vaultList, (_event, at: unknown) =>
  listVaultFiles(vault, at),
);
ipc.handle(CHANNELS.vaultStat, (_event, at: unknown) =>
  statVaultFile(vault, at),
);
ipc.handle(CHANNELS.vaultRemove, async (_event, at: unknown) => {
  if (typeof at === "string") vaultWatcher.noteSelfWrite(at);
  return removeVaultFile(vault, at);
});

/**
 * The local HTTP surface (§main-local-api), off until somebody switches it
 * on: the token, the semantic ranking, and the two IPC handlers that say
 * whether the door is open.
 */
const localApiDoor = registerMainLocalApi({
  ipc,
  vault,
  localDb,
  mainWindow: () => mainWindow,
  preferenceStore,
  secretStore,
});

ipc.handle(CHANNELS.zoteroLocal, async (_event, url: unknown) => {
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

ipc.handle(CHANNELS.texProbe, async () => {
  return { ok: true, value: await probeTex() };
});

/**
 * The handwriting helper's door (§main-ink): started on the first probe,
 * kept for the session, absent rather than rejected where there is none.
 */
const mainInk = registerMainInk({ ipc });

registerMainTex({ ipc });

ipc.handle(CHANNELS.vaultCommit, async () => {
  // The setting is read here rather than sent by the renderer: a window that
  // could pass its own `true` would be switching folder history on without
  // anybody having chosen it.
  const enabled = await preferenceStore().read("vault-git");
  return commitVaultFolder(vault, enabled.ok && enabled.value === true);
});

/**
 * The one thing `will-quit` waits for, and it is not allowed to wait forever.
 *
 * Closing the local database is what makes the next launch start from a clean
 * state, so it is done in order. But it is a WASM Postgres on a real disk, and
 * any one of a running statement, a file lock or a drive that has gone away can
 * make it take as long as it likes. An Electron process whose `will-quit`
 * neither returns nor exits stays alive with no window: invisible, holding the
 * single-instance lock, so every later launch raises a window that is not there
 * and quits. That is a machine that appears to have stopped running the app
 * until somebody opens Task Manager. `quit.ts` has the bound; it is longer
 * than any healthy close *and* the backup that now precedes it, and short
 * enough that nobody reaches for the power button.
 */
app.on("will-quit", (event) => {
  mainInk.dispose();
  event.preventDefault();
  runBoundedQuit({
    // A last copy first, then the close: the copy is what survives a close
    // that does not finish, and both are inside the bound.
    cleanup: shutDownLocalDb,
    exit: () => app.exit(0),
  });
});

// Disable Chromium history navigation gestures (swiping back/forward across the screen)
app.commandLine.appendSwitch("overscroll-history-navigation", "0");

// The id the installer's Start menu shortcut carries (`build.appId`). Without
// it Windows files the running window under Electron's default id, and the
// taskbar shows a second, unpinned button instead of the shortcut's icon.
if (process.platform === "win32") app.setAppUserModelId("dev.weaveforge.desktop");

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
    // The API's CORS is settled here, not by the server's allow-list: the
    // installed app must sign in whether or not the deployed Caddyfile names
    // `app://weaveforge` today. See `api-cors.ts` for what is rewritten and why.
    installApiCors(session.defaultSession, APP_ORIGIN);

    if (bundled) serveBundle();
    // Started before the window, so a sign-in cannot come back to a port that
    // is not listening yet.
    loopback = startAuthLoopback(deliverSignIn);
    // Taken back up only if it was switched on and there is still a token to
    // present. A door left open in the settings with its key thrown away
    // stays shut.
    void localApiDoor.resume();
    createWindow();
    // Updates are fetched in the background and installed only when the reader
    // says so -- see `auto-update.ts` for why quitting is not consent on an
    // unsigned build. The older check-and-tell path stays for the menu entry
    // and for builds with no feed behind them.
    void realUpdater().then((updater) => {
      if (updater)
        startAutoUpdate({
          updater,
          window: () => mainWindow,
          enabled: true,
          // Closed before the installer exists, not raced against its kill.
          prepare: shutDownLocalDb,
        });
    });
    refreshMenu();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("will-quit", () => {
    loopback?.close();
    loopback = null;
    void localApiDoor.close();
  });

  app.on("window-all-closed", () => {
    // macOS keeps the app running with no windows; everywhere else that means
    // the reader is finished.
    if (process.platform !== "darwin") app.quit();
  });
}

