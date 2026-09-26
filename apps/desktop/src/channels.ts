/**
 * The IPC channels, named once.
 *
 * Both sides of an Electron app talk over strings, and a typo in one of them is
 * a handler that silently never fires. They are declared here, with the shapes
 * that cross, so the main process and the preload script are checked against
 * the same definition rather than against each other's memory.
 *
 * What crosses is deliberately plain: strings, numbers and an `ArrayBuffer`.
 * Electron structured-clones IPC payloads, so a `Uint8Array` view over a larger
 * buffer, a `Blob` or an `Error` would each arrive as something else — or not
 * at all.
 */

export const CHANNELS = {
  fetchTitle: "weaveforge:fetch-title",
  fetchImage: "weaveforge:fetch-image",
  /**
   * The odd one out: main → renderer, and not a request at all.
   *
   * A sign-in finishes in the reader's browser, which redirects to a listener
   * this process runs. The page never asks for that — it arrives — so this is
   * an event rather than an `invoke`, and it carries the callback's query
   * string exactly as it was received.
   */
  signIn: "weaveforge:sign-in",
  /**
   * Whether a newer desktop release exists.
   *
   * Answered here rather than fetched by the page, because the page does not
   * know what it is running inside: the version lives in this process, and the
   * page is the same web build a browser gets.
   */
  checkUpdate: "weaveforge:check-update",
  /**
   * The keychain: read one named secret, keep one, forget one. What may be
   * named and what happens when the machine has no keychain is
   * `secret-store.ts`; these are only the strings.
   */
  secretRead: "weaveforge:secret-read",
  secretWrite: "weaveforge:secret-write",
  secretClear: "weaveforge:secret-clear",
  /**
   * The shell's own settings: read one, keep one. What may be named and why
   * these live outside the renderer is `preference-store.ts`; these are only
   * the strings.
   */
  preferenceRead: "weaveforge:preference-read",
  preferenceWrite: "weaveforge:preference-write",
  /**
   * One statement against the local database, answered with its rows.
   *
   * No transaction crosses: PGlite is a single connection, and a renderer that
   * could open one could hold the only connection the app has while a tab sits
   * behind a breakpoint. Each call is its own transaction on the far side, with
   * the role and the claim set inside it — see `local-db.ts`.
   */
  dbQuery: "weaveforge:db-query",
  /**
   * Whether the local database opened, and where it lives; and the one way
   * out when it did not.
   *
   * A data directory that a crash or a force-quit left half-written cannot be
   * opened by any later boot, and the page would otherwise be showing an
   * Emscripten abort with a Reload button that reloads into the same abort.
   * `dbReset` moves that directory aside — never deletes it — and is refused
   * while the database is healthy. See `local-db-host.ts`.
   */
  dbState: "weaveforge:db-state",
  dbReset: "weaveforge:db-reset",
  /**
   * The workspace folder: choose one, ask which one is chosen, read and write
   * inside it. What may be chosen and how a path is kept inside the root is
   * `vault-folder.ts`; these are only the strings.
   *
   * Only `vaultChoose` opens a dialog, and only in response to the renderer
   * asking — a folder is never picked on the app's own initiative.
   */
  vaultChoose: "weaveforge:vault-choose",
  vaultRoot: "weaveforge:vault-root",
  vaultForget: "weaveforge:vault-forget",
  vaultRead: "weaveforge:vault-read",
  vaultWrite: "weaveforge:vault-write",
  /**
   * The same two, for bytes. Text goes over `vaultRead`/`vaultWrite` as a
   * string; a PDF decoded as UTF-8 and re-encoded is not the same file, so
   * blobs cross as `Uint8Array` (structured clone carries them intact) and
   * get their own, larger cap.
   */
  vaultReadBytes: "weaveforge:vault-read-bytes",
  vaultWriteBytes: "weaveforge:vault-write-bytes",
  vaultList: "weaveforge:vault-list",
  vaultStat: "weaveforge:vault-stat",
  vaultRemove: "weaveforge:vault-remove",
  vaultCommit: "weaveforge:vault-commit",
  localApiState: "weaveforge:local-api-state",
  /**
   * One read of the Zotero running on this machine, proxied.
   *
   * The page cannot make the request itself -- plain-HTTP loopback from an
   * `app://` or `https://` document is mixed content -- and this channel is
   * deliberately not a general fetch: `zotero-local.ts` refuses every URL that
   * is not Zotero's own local API.
   */
  zoteroLocal: "weaveforge:zotero-local",
  /**
   * Whether this computer has a TeX, and one compile with it.
   *
   * The app ships no TeX -- a full TeX Live is several gigabytes -- so the
   * probe answers null on most machines and the feature stays hidden.
   */
  /**
   * Main -> renderer: rank these files against this query.
   *
   * The encoder lives in the window, so the MCP server has to ask for a
   * ranking rather than compute one. The window answers on `semanticRanked`,
   * or does not, and the server keeps the order the word search gave it.
   */
  semanticRank: "weaveforge:semantic-rank",
  semanticRanked: "weaveforge:semantic-ranked",
  texProbe: "weaveforge:tex-probe",
  texCompile: "weaveforge:tex-compile",
  localApiSet: "weaveforge:local-api-set",
  /**
   * Main -> renderer, like `signIn`: somebody else changed the folder.
   *
   * Carries the paths that changed and nothing about what happened to them.
   * A rename arrives as two paths and a delete as one, and telling those apart
   * from filesystem events alone is guesswork the reader does better by
   * looking at the folder -- which it has to do anyway to say what changed.
   */
  vaultChanged: "weaveforge:vault-changed",
  /**
   * One read of a linked Overleaf project, cloned here rather than by a server.
   *
   * The page names the project and the entry file; it never names the token,
   * which is read from the keychain on this side and never crosses. That is
   * the same division the hosted build makes -- there the token is sealed with
   * a server key and the clone happens on the server -- so a copy with no
   * account gets the feature without the page ever holding the credential.
   */
  overleafRead: "weaveforge:overleaf-read",
  /**
   * The Windows Ink recogniser: whether the helper is present, and one page's
   * lines through it. The helper is a process this side starts and keeps
   * (`ink-recogniser.ts`); the page sends stroke trajectories and gets text
   * back, and nothing leaves the machine.
   */
  inkAvailable: "weaveforge:ink-available",
  inkRecognise: "weaveforge:ink-recognise",
  /**
   * The pen's haptics (ink-native-bridges.md §4), through the same helper.
   * `inkHaptics` is `send`, not `invoke`: it carries a sample at up to 120 Hz
   * and nothing answers it.
   */
  inkHapticsAvailable: "weaveforge:ink-haptics-available",
  inkHaptics: "weaveforge:ink-haptics",
  /**
   * The application log: the page posts to it, and reads it back.
   *
   * Neither direction is a general file interface. `appReport` accepts an entry
   * from the fixed shape in `app-log.ts` and nothing else; `appReveal` opens the
   * one file the shell chose. The page names no path in either direction, which
   * is deliberate — this is the record of what went wrong, and a channel a page
   * could use to name a file would be a worse hole than the one it fills.
   */
  appReport: "weaveforge:app-report",
  appRead: "weaveforge:app-read",
  appReveal: "weaveforge:app-reveal",
  /**
   * The workspace's focus mode (`⌘⇧F`) reaching the window: the page hides
   * its own chrome, and asks here for the window's — the menu bar and the
   * title bar — to go with it, and to come back. `send`, not `invoke`: a
   * flag, and nothing answers it.
   */
  windowFocus: "weaveforge:window-focus",
  /**
   * The menu bar the page draws on Windows and Linux, where the window has no
   * title bar of its own. The menu itself stays in this process — its
   * accelerators, its roles — and the page asks for a picture of it
   * (`menuModel`), names an entry to run (`menuInvoke`), hears when it changed
   * (`menuChanged`, main -> renderer), and tints the window buttons to the
   * theme (`titleBarColors`, `send`).
   */
  menuModel: "weaveforge:menu-model",
  menuInvoke: "weaveforge:menu-invoke",
  menuChanged: "weaveforge:menu-changed",
  titleBarColors: "weaveforge:title-bar-colors",
} as const;

/**
 * What a handler answers with.
 *
 * A failure is a value, not a thrown error: an exception thrown inside
 * `ipcMain.handle` reaches the renderer as an `Error` with Electron's own
 * prefix stapled to the front of the message, and the paste code shows that
 * message to a person. So the reason travels as data and the preload turns it
 * back into an error on the far side.
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface TitlePayload {
  title: string;
  url: string;
}

export interface ImagePayload {
  bytes: ArrayBuffer;
  contentType: string;
  url: string;
}

/** The chosen workspace folder, or `null` when none is chosen yet. */
export interface VaultRootPayload {
  path: string;
  /** Whether the folder already held a workspace when it was chosen. */
  state: "empty" | "existing";
}

/** One entry of a folder listing, flattened for the wire. */
export interface VaultEntryPayload {
  path: string;
  kind: "file" | "dir";
  size: number;
  modifiedAt: string;
}

/** What the page posts to the application log. The shell stamps the time. */
export interface AppLogReportPayload {
  level: "error" | "warn" | "info";
  source: string;
  message: string;
  detail?: string;
}

/**
 * The application log as the page receives it.
 *
 * `text` is the entries already formatted — one line each, oldest first — so the
 * page can show them without a second parser and a second answer to "what does
 * a log line look like". `file` is where they are also written, so the reader
 * can open the same record in an editor.
 */
export interface AppLogPayload {
  file: string;
  text: string;
  /** False when the in-memory ring dropped older entries than `text` holds. */
  complete: boolean;
}

/** One entry of the menu, as the page's menu bar draws it. */
export interface MenuItemPayload {
  id: string;
  kind: "item" | "check" | "separator";
  label: string;
  /** The shortcut as the platform writes it (`Ctrl+Shift+I`), or null. */
  accelerator: string | null;
  enabled: boolean;
  checked?: boolean;
  /** Set when the entry only opens a route, so the page can navigate itself. */
  route?: string;
  /** A page action (`search`) the page runs itself. */
  command?: string;
}

export interface MenuGroupPayload {
  label: string;
  items: MenuItemPayload[];
}
