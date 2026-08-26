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
  vaultList: "weaveforge:vault-list",
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
