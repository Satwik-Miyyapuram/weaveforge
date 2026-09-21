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
  resolveAppFile,
} from "./app-protocol";
import type { LocalClient } from "./local-db";
import { LocalDbBackups, readBackup } from "./local-db-backup";
import { LocalDbHost } from "./local-db-host";
import { applyDeferredMove, moveAside } from "./local-db-reset";
import { readHomeConfig, writeHomeConfig } from "./home-config";
import {
  adoptRoot,
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
import { registerMainInk } from "./main-ink";
import { registerMainLocalApi } from "./main-local-api";
import { registerMainUpdateOffer } from "./main-update-offer";
import { registerMainVaultWatch } from "./main-vault-watch";
import { fetchZoteroLocal } from "./zotero-local";
import { compileTex, probeTex, type TexSourceFile } from "./tex";
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
import { CHANNELS } from "./channels";
import { preferenceStore, secretStore } from "./main-stores";
import { fetchReleases, findUpdate } from "./update-check";
import { installMenu, routeTo } from "./app-menu";
import { realUpdater, startAutoUpdate } from "./auto-update";
import { originOf, registerGuardedIpc, sameOrigin } from "./ipc-guard";
import { runBoundedQuit } from "./quit";

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

/** Where the Help menu sends a reader. Matches the app's own docs link. */
const DOCS_URL = "https://www.weaveforge.org/docs/";

let mainWindow: BrowserWindow | null = null;
let loopback: import("node:http").Server | null = null;

/*
 * Memory (docs/internal/design/memory-optimization.md, tiers 1 and 2).
 *
 * Every switch must be appended before `whenReady`; Chromium reads them when
 * it starts its subprocesses. The V8 cap applies to every renderer and worker
 * isolate. 512 MB rather than the note's 256: the encoder worker's JS heap
 * and a large vault's search index both live under it, and an isolate that
 * hits the cap is killed outright, which costs far more than the difference.
 */
app.commandLine.appendSwitch(
  "js-flags",
  "--max-old-space-size=512 --optimize-for-size",
);
app.commandLine.appendSwitch("disable-speech-api");
app.commandLine.appendSwitch("disable-print-preview");
app.commandLine.appendSwitch(
  "disable-features",
  [
    "Translate",
    "AutofillServerCommunication",
    "CalculateNativeWinOcclusion",
    "MediaRouter",
    "OptimizationHints",
  ].join(","),
);
app.commandLine.appendSwitch("force-color-profile", "srgb");
app.commandLine.appendSwitch("max-active-webgl-contexts", "4");

/** How long a blurred window sits before its working set is trimmed. */
const IDLE_TRIM_MS = 180_000;
let idleTrim: NodeJS.Timeout | null = null;

/**
 * Hand inactive pages back to Windows. `process.trimWorkingSet` is Electron's
 * own binding over `EmptyWorkingSet`; it drops the cached pages the OS would
 * otherwise keep resident for lack of pressure, and the next focus faults them
 * back in without a visible stall. A no-op elsewhere.
 */
function trimProcessMemory(): void {
  if (process.platform !== "win32") return;
  const trim = (process as unknown as { trimWorkingSet?: () => void })
    .trimWorkingSet;
  try {
    trim?.();
  } catch {
    // Not fatal: the working set is merely left as it was.
  }
}

function registerMemoryTrimming(window: BrowserWindow): void {
  window.on("minimize", trimProcessMemory);
  window.on("blur", () => {
    if (idleTrim) clearTimeout(idleTrim);
    idleTrim = setTimeout(trimProcessMemory, IDLE_TRIM_MS);
  });
  window.on("focus", () => {
    if (idleTrim) clearTimeout(idleTrim);
    idleTrim = null;
  });
}

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
  registerMemoryTrimming(window);

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
    if (!file) return new Response(null, { status: 404 });

    const response = await net.fetch(pathToFileURL(file).toString());
    return new Response(response.body, {
      status: response.status,
      headers: appHeaders(contentTypeFor(file)),
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

/**
 * The local database, opened on first use under the app's own directory.
 *
 * PGlite is imported here and nowhere else, and lazily: it is a WASM Postgres,
 * and an app that stays online for its whole life should never pay to load it.
 */
const localDbDir = path.join(app.getPath("userData"), "local-db");

/**
 * Copies of the database, under the app's directory and under the workspace
 * folder's `.weaveforge/` when there is one; see `local-db-backup.ts`. Taken
 * every so often while something has changed, and on the way out.
 */
const BACKUP_EVERY_MS = 10 * 60 * 1000;
const localDbBackups = new LocalDbBackups({
  dirs: () => {
    const dirs = [path.join(app.getPath("userData"), "local-db-backups")];
    const root = vault.root?.path;
    if (root) dirs.push(path.join(root, ".weaveforge", "db-backups"));
    return dirs;
  },
});

/** Start the engine on `localDbDir`, from a backup's bytes when given some. */
async function openEngine(loadDataDir?: Blob): Promise<LocalClient> {
  const { PGlite, types } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  return (await PGlite.create({
    dataDir: localDbDir,
    extensions: { pgcrypto },
    // Rows cross to the renderer shaped as PostgREST would send them, and the
    // repositories were written against that: a `date` is its `YYYY-MM-DD`
    // text and a timestamp is ISO text. PGlite's default turns both into
    // `Date` objects, which survive the bridge -- and a logbook entry's day
    // rendered as one was React's "objects are not valid as a child".
    parsers: {
      [types.DATE]: (x) => x,
      [types.TIMESTAMPTZ]: (x) => new Date(x).toISOString(),
    },
    ...(loadDataDir ? { loadDataDir } : {}),
  })) as unknown as LocalClient;
}

const localDb = new LocalDbHost({
  migrations: [
    path.join(__dirname, "migrations"),
    path.join(__dirname, "migrations-local"),
  ],
  dataDir: localDbDir,
  open: async () => {
    // A reset the previous run could only write down; see `local-db-reset.ts`.
    applyDeferredMove(localDbDir);
    // The folder's backups are only findable once the folder is known, and
    // the folder is taken up in the background at boot.
    await rootRestored;
    // No database at all -- a fresh install, or a reset -- but a backup: the
    // backup is what the person had, so it is what they get back.
    if (!fs.existsSync(localDbDir)) {
      const latest = await localDbBackups.latest();
      if (latest) {
        console.log(`[local-db] no database; restoring from ${latest}`);
        return openEngine(await readBackup(latest));
      }
    }
    return openEngine();
  },
  recover: async (cause) => {
    const latest = await localDbBackups.latest();
    if (!latest) return null;
    console.warn(`[local-db] open failed (${String(cause)}); restoring from ${latest}`);
    // The engine that failed may still hold the directory. When it does, the
    // move waits for a process that has never opened it -- this one,
    // relaunched -- and that boot finds no directory and restores (above).
    if ((await moveAside(localDbDir)) === "deferred") {
      app.relaunch();
      app.exit(0);
      return null;
    }
    return { client: await openEngine(await readBackup(latest)), from: latest };
  },
  discard: async () => {
    // As in `recover`, for the button on the page.
    if ((await moveAside(localDbDir)) === "deferred") {
      app.relaunch();
      app.exit(0);
    }
  },
});

/** Write a backup if anything changed; never throws, never opens the database. */
async function backUpLocalDb(): Promise<void> {
  try {
    const blob = await localDb.snapshot();
    if (!blob) return;
    const written = await localDbBackups.take({ dumpDataDir: async () => blob });
    if (written.length > 0) console.log(`[local-db] backed up to ${written.join(", ")}`);
  } catch (error) {
    console.warn(`[local-db] backup failed: ${String(error)}`);
  }
}
setInterval(() => void backUpLocalDb(), BACKUP_EVERY_MS).unref();

ipc.handle(CHANNELS.dbQuery, (_event, sql: unknown, params: unknown) =>
  localDb.query(sql, params),
);
ipc.handle(CHANNELS.dbState, () => ({ ok: true, value: localDb.state() }));
ipc.handle(CHANNELS.dbReset, () => localDb.reset());

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
  .then((root) => (root ? vaultWatcher.start(root.path) : null))
  .catch(() => null)
  .then(() => undefined);

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
  const adopted = await adoptRoot(
    vault,
    result.canceled ? null : (result.filePaths[0] ?? null),
    rememberRoot,
  );
  if (adopted.ok && adopted.value) vaultWatcher.start(adopted.value.path);
  return adopted;
}

ipc.handle(CHANNELS.vaultChoose, () => chooseWorkspaceFolder());

ipc.handle(CHANNELS.vaultRoot, () => currentRoot(vault));
ipc.handle(CHANNELS.vaultForget, () => {
  vaultWatcher.stop();
  return forgetRoot(vault, rememberRoot);
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

ipc.handle(
  CHANNELS.texCompile,
  async (_event, files: unknown, entryFile: unknown) => {
    // The page names the files; `compileTex` refuses any path that would leave
    // the temporary directory it makes, so nothing here is written near the
    // reader's own work.
    if (!Array.isArray(files) || typeof entryFile !== "string") {
      return { ok: false, message: "That is not a project to compile." };
    }
    try {
      return {
        ok: true,
        value: await compileTex(files as TexSourceFile[], entryFile),
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "The compile could not be started.",
      };
    }
  },
);

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
    cleanup: () => backUpLocalDb().then(() => localDb.close()),
    exit: () => app.exit(0),
  });
});

// Disable Chromium history navigation gestures (swiping back/forward across the screen)
app.commandLine.appendSwitch("overscroll-history-navigation", "0");

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
        startAutoUpdate({ updater, window: () => mainWindow, enabled: true });
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
    void localApiDoor.close();
  });

  app.on("window-all-closed", () => {
    // macOS keeps the app running with no windows; everywhere else that means
    // the reader is finished.
    if (process.platform !== "darwin") app.quit();
  });
}

