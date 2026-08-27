"use client";

/**
 * What the desktop build adds, and how the web build asks whether it is there.
 *
 * This file is the entire contract between the two. `apps/desktop` implements
 * it in the Electron main process and exposes it on `window.weaveforge` through
 * a preload script; every feature that can take advantage of it does so through
 * a capability interface with a browser implementation beside it, so nothing in
 * the app is desktop-only and nothing is written twice.
 *
 * Keeping the surface this small is deliberate. Each entry is something a
 * browser genuinely cannot do — not a faster path to something it can — because
 * every entry is also a hole in the sandbox that separates the renderer from
 * the machine, and one that has to be reviewed on both sides forever.
 */

export interface DesktopImage {
  /**
   * The picture's bytes. An `ArrayBuffer` rather than a typed array because
   * that is what survives Electron's structured clone unambiguously, and the
   * renderer wraps it in a `Blob` at the one place that needs one.
   */
  bytes: ArrayBuffer;
  contentType: string;
  /** Where the redirects ended up. */
  url: string;
}

export interface DesktopBridge {
  /** Version of the desktop shell, so a mismatch can be reported rather than crash. */
  readonly version: string;
  /** The platform, for the few places a keyboard hint differs. */
  readonly platform: "darwin" | "win32" | "linux";

  /**
   * Reads a page's title without a server round trip.
   *
   * The same guard as the API route — the main process imports the same module
   * — so a desktop build is not a way around the address checks. What it avoids
   * is the round trip and the CORS barrier, neither of which exists here.
   */
  fetchTitle(url: string): Promise<{ title: string; url: string }>;

  /** Downloads a picture, under the same guard and the same size cap. */
  fetchImage(url: string): Promise<DesktopImage>;

  /**
   * Calls back when a provider sign-in returns, with the callback's query
   * string, and answers with the way to stop listening.
   *
   * The sign-in itself happens in the reader's real browser — a provider will
   * not run inside an embedded window, and this window sends off-origin
   * navigations out to the browser anyway. The browser is then redirected to a
   * loopback address the desktop shell is listening on, which is the shape
   * RFC 8252 asks a native app to use, and the shell forwards what arrived.
   *
   * A browser has no equivalent and needs none: there the provider redirects
   * back to the page itself.
   */
  /**
   * Listens for somebody else changing the mirrored folder.
   *
   * Carries the paths that changed and nothing about what happened to them: a
   * rename arrives as two paths and a delete as one, and telling those apart
   * from filesystem events is guesswork the reader does better by looking.
   *
   * A browser has no equivalent and needs none: it cannot watch a directory it
   * was handed, which is why the workspace port does not pretend to.
   */
  onVaultChange(cb: (paths: string[]) => void): () => void;

  onSignIn(cb: (query: string) => void): () => void;

  /**
   * Whether a newer desktop release exists, or null if not — which covers
   * being up to date, being unable to reach GitHub, and running from source.
   *
   * A browser has no equivalent and needs none: a browser is never out of
   * date, because the app it loads is whatever the server is serving. This
   * asks about the *window*, whose version lives in the shell and nowhere the
   * page can read it.
   */
  checkUpdate(): Promise<DesktopUpdate | null>;

  /**
   * Reads one of the shell's own settings, or null if it has never been set.
   *
   * These are the few things the *window* remembers rather than the app: they
   * have to survive a reinstall, or be answerable before there is a session to
   * answer them from. A browser has no equivalent and needs none — it is
   * already online, and its settings live with its account.
   */
  readPreference(name: DesktopPreferenceName): Promise<DesktopPreferenceValue>;

  /** Keeps one. Writing null forgets it. */
  writePreference(name: DesktopPreferenceName, value: DesktopPreferenceValue): Promise<void>;

  /**
   * The operating system's keychain, for the few credentials worth keeping.
   *
   * A browser has no equivalent, and this is the one place that distinction
   * changes a policy rather than a mechanism. The AI provider key is held in
   * memory and nowhere else in a browser, deliberately — storage the origin can
   * read is storage this app manages, and a credential the reader controls
   * should not become one we hold. On a machine with a keychain the operating
   * system holds it instead, and what reaches the disk is a blob no other user
   * account can decrypt, so the reasoning that forbids it in a browser is the
   * reasoning that permits it here.
   *
   * `name` is checked in the main process against a short list; an unknown name
   * is refused rather than stored. `write` rejects when the machine has no
   * keychain backend, and it never falls back to something weaker — a refusal
   * means the credential stays in memory for the session, which is the browser
   * behaviour and is correct.
   */
  readSecret(name: DesktopSecretName): Promise<string | null>;
  writeSecret(name: DesktopSecretName, value: string): Promise<void>;
  clearSecret(name: DesktopSecretName): Promise<void>;

  /**
   * Run one statement against the local database and get its rows.
   *
   * Present only on the desktop, and only meaningful there: the local database
   * is a process the browser does not have. Each call is its own transaction on
   * the far side, so nothing here can hold a connection open.
   */
  queryLocalDb(sql: string, params?: readonly (string | number | boolean | null)[]): Promise<unknown[]>;

  /**
   * The workspace folder on disk: the same markdown the export produces, but
   * live, so an outside editor can open it while the app is running.
   *
   * A browser has no equivalent worth having. The File System Access API can
   * hold a directory handle, but not across a reinstall and not while the tab
   * is closed, which is exactly when an outside editor would be used.
   *
   * `chooseVaultRoot` is the only way a folder is picked, and it opens a
   * dialog every time: the page names no path, so a page that is talked into
   * calling this gets a folder picker in front of a person rather than a
   * silent write somewhere. It answers with the folder unchanged when the
   * dialog is dismissed.
   */
  chooseVaultRoot(): Promise<DesktopVaultRoot | null>;
  /** The folder currently in use, or null when none has been chosen. */
  vaultRoot(): Promise<DesktopVaultRoot | null>;
  /** Stop using the folder. The files stay; the app stops writing to them. */
  forgetVaultRoot(): Promise<void>;
  /** Read one file, or null when it is not there yet. */
  readVaultFile(path: string): Promise<string | null>;
  writeVaultFile(path: string, contents: string): Promise<void>;
  /** One level of a directory, `""` for the root. */
  listVaultFiles(path?: string): Promise<DesktopVaultEntry[]>;
  /** One entry, or null when it is not there. */
  statVaultFile(path: string): Promise<DesktopVaultEntry | null>;
  /** Remove one file the mirror owns. Never used on anything else. */
  removeVaultFile(path: string): Promise<void>;
  /**
   * Commit what the mirror wrote, if folder history is switched on.
   *
   * Answers with a reason rather than throwing when it declined -- switched
   * off, or a folder sitting inside somebody else's repository -- because both
   * are ordinary and neither should cost the caller its write.
   */
  commitVault(): Promise<DesktopCommitResult>;
  /** Whether the local HTTP surface is listening, and on what. */
  localApiState(): Promise<DesktopLocalApi>;
  /**
   * Switch the local HTTP surface on or off.
   *
   * Switching it on generates a token and answers with it once. Nothing shows
   * it again: a token that can be re-read from a settings panel is a token
   * that can be re-read by anything that can reach the panel.
   */
  setLocalApi(enabled: boolean): Promise<DesktopLocalApi>;
  /**
   * One read of the Zotero API running on this computer.
   *
   * Not a fetch: the shell refuses every URL that is not
   * `http://127.0.0.1:23119/api/...`, so this cannot be used to reach anything
   * else the machine can reach. It exists because a plain-HTTP loopback
   * request from this document is blocked as mixed content.
   */
  zoteroLocal(url: string): Promise<DesktopZoteroReply>;
  /**
   * The TeX on this machine, or null. Answered fresh each call, so somebody
   * installing one while the app is open does not have to restart it.
   */
  probeTex(): Promise<DesktopTexTool | null>;
  compileTex(
    files: readonly { path: string; content: string }[],
    entryFile: string,
  ): Promise<DesktopTexCompileResult>;

  /**
   * The LaTeX source of one linked Overleaf project, cloned on this machine.
   *
   * On a server this is an API route: the route holds the sealed token, clones
   * into a directory it then throws away, and hands back the text. A copy with
   * no account has no route and no sealing key, so the shell does the same
   * work with the token from the keychain. The page names the project and the
   * entry file and never sees the credential either way.
   *
   * Requires a token to have been kept under `overleaf-token`; without one
   * this rejects, and the caller's recourse is to ask for it again.
   */
  readOverleafProject(projectId: string, entryFile: string): Promise<DesktopOverleafSource>;
}

/** One Overleaf checkout, flattened for the wire. */
export interface DesktopOverleafSource {
  projectId: string;
  entryFile: string;
  files: { path: string; content: string }[];
  overleafUrl: string;
}

/** The TeX this computer has, or null when it has none. */
export interface DesktopTexTool {
  kind: "latexmk" | "tectonic" | "pdflatex";
  command: string;
  version: string;
}

export interface DesktopTexError {
  file: string;
  /** 1-based, or 0 when the engine did not say. */
  line: number;
  message: string;
}

export interface DesktopTexCompileResult {
  ok: boolean;
  pdf: ArrayBuffer | null;
  log: string;
  errors: DesktopTexError[];
  /** null means no TeX was found, which is not a failure to report loudly. */
  engine: DesktopTexTool["kind"] | null;
}

/** A local Zotero response, flattened for the wire. */
export interface DesktopZoteroReply {
  status: number;
  body: string;
  /** Only the headers the pager reads: total-results, backoff, retry-after. */
  headers: Record<string, string>;
}

export interface DesktopCommitResult {
  /** The commit made, or null when there was nothing to commit or it declined. */
  commit: DesktopCommit | null;
  /** Why nothing was committed, when that was a decision rather than a no-op. */
  reason?: string;
}

export interface DesktopLocalApi {
  enabled: boolean;
  /** Loopback only. Present whether or not it is currently listening. */
  url: string;
  /** The token, once, on the call that generated it. Never afterwards. */
  token?: string;
  /** Why it is not listening, when that was not the user's choice. */
  reason?: string;
}

export interface DesktopCommit {
  oid: string;
  message: string;
  authoredAt: string;
  author: string;
}

export interface DesktopVaultRoot {
  path: string;
  /** Whether the folder already held a workspace when it was chosen. */
  state: "empty" | "existing";
}

export interface DesktopVaultEntry {
  path: string;
  kind: "file" | "dir";
  size: number;
  modifiedAt: string;
}

/** What may be kept. Mirrored in `apps/desktop/src/secret-store.ts`. */
export type DesktopSecretName = "ai-provider" | "local-api-token" | "overleaf-token";

/** What the shell remembers. Mirrored in `apps/desktop/src/preference-store.ts`. */
export type DesktopPreferenceName =
  | "sync-offer-shown"
  | "sync-target"
  | "vault-root"
  | "vault-git"
  | "local-api";
export type DesktopPreferenceValue = string | boolean | null;

export interface DesktopUpdate {
  /** The newer version, as `0.6.0`. */
  version: string;
  /** Its release page, to be opened in the reader's real browser. */
  url: string;
}

declare global {
  interface Window {
    weaveforge?: DesktopBridge;
  }
}

/**
 * The bridge, or null in a browser.
 *
 * Read through a function rather than exported as a value because the preload
 * script runs before the bundle and a module-level read would be evaluated
 * during the server render, where `window` does not exist.
 */
export function desktop(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.weaveforge;
  // Checked by shape rather than by presence: a page in a browser can have
  // anything on `window`, and a half-initialised bridge should read as absent.
  if (!bridge || typeof bridge.fetchTitle !== "function") return null;
  return bridge;
}
