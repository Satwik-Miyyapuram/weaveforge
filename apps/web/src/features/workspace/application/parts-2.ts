import {
  desktop,
  type DesktopBridge,
  type DesktopGithubCode,
  type DesktopGithubConnected,
  type DesktopVaultSync,
  type DesktopVaultSyncAction,
} from "@/lib/desktop/desktop-bridge";
import { loadCore, readyCore, typedCore } from "@/lib/rust-core";
import { folderLock } from "./folder-lock";

// --- import-limits ---
/**
 * Bounds on an imported archive.
 *
 * The folder is untrusted: it may have been shared by a collaborator or written
 * by something else on disk. `unzipSync` will happily inflate a 40 KB file into
 * gigabytes and will happily hand back an entry called `../../etc/passwd`, so
 * both are checked before anything is read.
 *
 * The same shape of caps the Overleaf reader already applies to a cloned repo.
 */
export const IMPORT_LIMITS = {
  /** Total uncompressed bytes across every entry. */
  maxTotalBytes: 256 * 1024 * 1024,
  /** One file. A single markdown note far past this is not a note. */
  maxFileBytes: 32 * 1024 * 1024,
  maxEntries: 20_000,
} as const;

export class ImportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportLimitError";
  }
}

type ImportLimits = { readonly [K in keyof typeof IMPORT_LIMITS]: number };

/** Rust reports a cap as a plain error; the callers match `ImportLimitError`. */
function asImportLimitError(error: unknown): unknown {
  return error instanceof Error ? new ImportLimitError(error.message) : error;
}

/** What the archive's directory says about one entry, before it is inflated. */
export interface ArchiveEntryInfo {
  name: string;
  originalSize: number;
}

/**
 * A `filter` for `unzipSync` that checks the archive's own directory first.
 *
 * Too many entries, or a declared total past the cap, throws before anything
 * is inflated. An entry declared over the file cap is skipped and named in
 * `oversize`. A declared size can lie, so the real bytes are checked afterwards.
 * The counting is Rust's (`ArchiveBudget`).
 */
export function archiveBudget(limits: ImportLimits = IMPORT_LIMITS): {
  filter: (info: ArchiveEntryInfo) => boolean;
  readonly oversize: string[];
} {
  const core = readyCore();
  const budget = core.createArchiveBudget(limits);
  return {
    filter: (info) => {
      try {
        return budget.admit(info.name, info.originalSize);
      } catch (error) {
        throw asImportLimitError(error);
      }
    },
    get oversize() {
      return budget.oversize;
    },
  };
}

/** Inflate only the entries `archiveBudget` lets through. */
export async function unzipWithinLimits(
  bytes: Uint8Array,
  limits: ImportLimits = IMPORT_LIMITS,
): Promise<{ entries: Record<string, Uint8Array>; oversize: string[] }> {
  // `archiveBudget` runs Rust, so the core has to be loaded first.
  await loadCore();
  const { unzipSync } = await import("fflate");
  const budget = archiveBudget(limits);
  const entries = unzipSync(bytes, { filter: budget.filter });
  return { entries, oversize: budget.oversize };
}

export const SKIP_TOO_BIG = `it is over the ${Math.round(IMPORT_LIMITS.maxFileBytes / 1024 / 1024)} MB file limit`;

// --- folder-remote-sync ---
// checkGitRemoteUrl stays TS: it wraps the browser's URL parser, which WASM would duplicate.

/**
 * Pushing and pulling the workspace folder to a git remote (Settings → Workspace folder).
 *
 * Desktop only: the shell runs git, reads the URL and token from its own stores,
 * and never hands the token back. This module only stores what was typed and
 * names the action. Files a pull brings in reach the app the way any outside
 * edit to the folder does: the folder watcher reports them for import.
 */

const NO_SHELL = "Syncing with a git remote needs the desktop app.";

function shell(): (DesktopBridge & Required<Pick<DesktopBridge, "vaultSync">>) | null {
  const bridge = desktop();
  return bridge && typeof bridge.vaultSync === "function"
    ? (bridge as DesktopBridge & Required<Pick<DesktopBridge, "vaultSync">>)
    : null;
}

export function remoteSyncAvailable(): boolean {
  return shell() !== null;
}

/**
 * Whether GitHub sync is on: a remote URL is saved and a token is held. The
 * vault-git preference itself is write-only from the page, so the URL and the
 * token stand in for it. A failed read throws rather than answering: the sync
 * engine then aborts the cycle, so no push or pull runs on an unknown scope.
 */
export async function githubSyncConnected(): Promise<boolean> {
  if (!shell()) return false;
  const remote = await folderRemoteSync("settings");
  return remote.url !== null && remote.hasToken;
}

/**
 * Store the remote's URL, and the token when one was typed. An empty token
 * keeps the stored one; `null` forgets it. A URL that is not plain https is
 * refused before anything is stored. Answers the URL as stored.
 */
export async function saveRemoteSyncSettings(input: { url: string; token: string | null }): Promise<string> {
  const url = typedCore().checkGitRemoteUrl(input.url);
  if (!url.ok) throw new Error(url.reason);
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  await bridge.writePreference("vault-git-remote", url.url);
  if (input.token === null) await bridge.clearSecret("git-sync-token");
  else if (input.token.trim()) await bridge.writeSecret("git-sync-token", input.token.trim());
  return url.url;
}

/** Forget the stored token; the URL, typed or stored, plays no part. */
export async function forgetRemoteToken(): Promise<void> {
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  await bridge.clearSecret("git-sync-token");
}

/**
 * Forget the remote: its URL and its token. The folder and its history stay
 * as they are; only syncing stops until a URL is saved again.
 */
export async function disconnectRemote(): Promise<void> {
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  await bridge.writePreference("vault-git-remote", null);
  await bridge.clearSecret("git-sync-token");
}

const reauthListeners = new Set<() => void>();

/** Called when a sync fails because GitHub wants a new sign-in. Answers the unsubscribe. */
export function onGithubReauth(listener: () => void): () => void {
  reauthListeners.add(listener);
  return () => void reauthListeners.delete(listener);
}

/** Actions that can move the folder's tree: a pull and each conflict choice. */
const MOVES_TREE: ReadonlySet<DesktopVaultSyncAction> = new Set(["pull", "keep-mine", "take-remote", "keep-both"]);

/**
 * Runs one remote step. When it fails, re-reads the settings: if the shell
 * marked the GitHub token as refused, every `onGithubReauth` listener hears
 * it, so a failed auto-sync never fails silently.
 */
async function reportingReauth<T>(
  bridge: Required<Pick<DesktopBridge, "vaultSync">>,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const settings = await bridge.vaultSync("settings").catch(() => null);
    if (settings?.needsReconnect) for (const listener of [...reauthListeners]) listener();
    throw err;
  }
}

/**
 * Run one action on the remote. Those that touch the folder (a pull, a push,
 * a conflict choice) wait for the folder lock, so two of them never move the
 * folder at once. Reading the settings or the status does not.
 */
export async function folderRemoteSync(action: DesktopVaultSyncAction): Promise<DesktopVaultSync> {
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  return reportingReauth(bridge, () =>
    MOVES_TREE.has(action) || action === "push"
      ? folderLock.run(() => bridge.vaultSync(action))
      : bridge.vaultSync(action),
  );
}

type GithubShell = DesktopBridge &
  Required<Pick<DesktopBridge, "vaultSync" | "githubConnectStart" | "githubConnectFinish" | "githubConnectCancel">>;

function githubShell(): GithubShell | null {
  const bridge = shell();
  return bridge &&
    typeof bridge.githubConnectStart === "function" &&
    typeof bridge.githubConnectFinish === "function" &&
    typeof bridge.githubConnectCancel === "function"
    ? (bridge as GithubShell)
    : null;
}

/** The shell can sign in to GitHub and make the repo itself. */
export function githubConnectAvailable(): boolean {
  return githubShell() !== null;
}

/** Ask GitHub for the device code the user types at `verificationUri`. */
export function startGithubConnect(): Promise<DesktopGithubCode> {
  const bridge = githubShell();
  if (!bridge) return Promise.reject(new Error(NO_SHELL));
  return bridge.githubConnectStart();
}

/**
 * Wait for the code to be entered, then let the shell make the private repo
 * (or, on a reconnect, keep the one already set) and set it as the remote;
 * connect it so git knows the remote too. `uploadWorkspace` pushes next.
 */
export async function finishGithubConnect(name: string | null): Promise<DesktopGithubConnected> {
  const bridge = githubShell();
  if (!bridge) throw new Error(NO_SHELL);
  const connected = await bridge.githubConnectFinish(name);
  await bridge.vaultSync("connect");
  return connected;
}

/**
 * The first upload after connecting. When the repo already has commits (a
 * reused repo), pulls them in and pushes again. Rejects with a reason fit to
 * show, so the caller can offer Retry.
 */
export async function uploadWorkspace(): Promise<void> {
  const first = await folderRemoteSync("push");
  if (first.push?.kind !== "rejected") return;
  const { pulled, pushed } = await pullThenPush();
  if (pulled.pull?.kind === "conflict") {
    throw new Error(
      `These files changed both here and on GitHub: ${pulled.pull.files.join(", ")}. ` +
        "Pull under Settings → Workspace folder → Git remote, pick which copy to keep, then Retry.",
    );
  }
  if (pushed?.push?.kind === "rejected") throw new Error(pushed.push.reason);
}

/** Stop waiting; the pending finish rejects as cancelled. */
export async function cancelGithubConnect(): Promise<void> {
  await githubShell()?.githubConnectCancel();
}

/**
 * After a rejected push: pull, then push again, in one go. Stops after the
 * pull when it hits a conflict, so nothing is pushed until that is settled.
 * Holds the folder lock across both, so two of them never move the folder at once.
 */
export async function pullThenPush(): Promise<{ pulled: DesktopVaultSync; pushed: DesktopVaultSync | null }> {
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  return reportingReauth(bridge, () =>
    folderLock.run(async () => {
      const pulled = await bridge.vaultSync("pull");
      if (pulled.pull?.kind === "conflict") return { pulled, pushed: null };
      return { pulled, pushed: await bridge.vaultSync("push") };
    }),
  );
}

/** One line for the panel. */
export async function describeRemoteSync(reply: DesktopVaultSync): Promise<string> {
  const core = await loadCore();
  if (reply.pull) return core.describePull(reply.pull);
  if (reply.push) return core.describePush(reply.push);
  const status = reply.status;
  if (!status) return "";
  return core.describeRemoteStatus(status);
}
