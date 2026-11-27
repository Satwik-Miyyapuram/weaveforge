import { NoOpWorkspaceGit, safeWorkspacePath, type IWorkspaceFs, type IWorkspaceGit, type WorkspaceCommit } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { isOwnWrite } from "@/backend/providers/files/own-writes";
import { downloadLibraryPdfsOnce } from "@/features/reader/application/parts-1";
import { desktop, type DesktopVaultRoot } from "@/lib/desktop/desktop-bridge";
import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import { notifyEach, onWorkspaceChange } from "@/lib/parts";
import { loadCore, readyCore } from "@/lib/rust-core";
import {
  BrowserWorkspaceFs,
  DesktopWorkspaceFs,
  IsomorphicWorkspaceGit,
} from "../infrastructure/parts";
import { forgetVaultPaths } from "../infrastructure/vault-read-cache";
import { folderLock } from "./folder-lock";
import { type FileHistorySource, gitFileHistory, shellFileHistory } from "./parts-1";
import { type Coalescer, createCoalescer } from "./parts-3";
import { isNoActiveProject, watchForLoss } from "./parts";

/**
 * The workspace folder as the app uses it.
 *
 * Holds the chosen filesystem for the session. The handle is not persisted:
 * File System Access permission is per-session in most browsers anyway, and
 * silently reacquiring write access to a folder the user picked days ago is
 * not something to do on their behalf.
 */

let activeFs: IWorkspaceFs | null = null;
let activeGit: IWorkspaceGit = new NoOpWorkspaceGit();

/**
 * The open folder's filesystem, for a feature that reads or writes the folder's
 * files directly — notes, ink, the trash. `null` while
 * no folder is open, and the caller is expected to have somewhere else to go.
 */
export function activeWorkspaceFs(): IWorkspaceFs | null {
  return activeFs;
}

/**
 * Settles once the launch-time folder restore has had its answer.
 *
 * Something that reads through `activeWorkspaceFs` in the first moments of a
 * session — an ink note opened straight from a link — would otherwise see no
 * folder, read the bucket instead, and show the note empty. A browser has no
 * remembered folder, so there is nothing to wait for; on the desktop the wait
 * is capped, so a restore that never reports cannot hold the reader forever.
 */
const FOLDER_RESTORE_WAIT_MS = 10_000;
let settleRestore!: () => void;
const restoreSettled = new Promise<void>((resolve) => {
  settleRestore = resolve;
});
let restoreWait: Promise<void> | null = null;

export function folderRestored(): Promise<void> {
  if (!desktop()) return Promise.resolve();
  restoreWait ??= Promise.race([
    restoreSettled,
    new Promise<void>((resolve) => setTimeout(resolve, FOLDER_RESTORE_WAIT_MS)),
  ]);
  return restoreWait;
}

/** Called by the launch-time restore when it has connected, or given up. */
export function markFolderRestored(): void {
  settleRestore();
}




export interface FolderSession {
  kind: "picked" | "opfs" | "desktop";
  git: "none" | "isomorphic";
}

const connectedListeners = new Set<() => void>();

/**
 * Called whenever a folder is connected, reconnection at launch included.
 * For things that keep a copy of their own state in the folder and must write
 * it once there is somewhere to write it.
 */
export function onFolderConnected(listener: () => void): () => void {
  connectedListeners.add(listener);
  return () => connectedListeners.delete(listener);
}

function announceConnected(): void {
  markFolderRestored();
  notifyEach(connectedListeners, "folder-connected");
}

export function folderSession(): FolderSession | null {
  if (!activeFs) return null;
  return {
    kind:
      activeFs instanceof DesktopWorkspaceFs
        ? "desktop"
        : activeFs instanceof BrowserWorkspaceFs
          ? "picked"
          : "opfs",
    git: activeGit.kind === "isomorphic" ? "isomorphic" : "none",
  };
}

export function supportsDirectoryPicker(): boolean {
  return BrowserWorkspaceFs.supportsDirectoryPicker;
}

/**
 * Pick a real folder. Returns false when the user dismissed the picker.
 */
export async function chooseFolder(options: { git: boolean }): Promise<boolean> {
  const fs = await BrowserWorkspaceFs.pickDirectory();
  if (!fs) return false;
  adoptBrowserFolder(fs, options.git);
  return true;
}

/** Take up a browser folder: its git, following edits, a first sync, the news. */
function adoptBrowserFolder(fs: BrowserWorkspaceFs, git: boolean): void {
  // F97-P2-19: let go of the old folder first, so its watcher and syncs stop.
  if (activeFs) closeFolder();
  activeFs = fs;
  activeGit = git ? new IsomorphicWorkspaceGit(fs) : new NoOpWorkspaceGit();
  watchForChanges();
  // Connecting a folder runs a sync straight away rather than waiting for the next write.
  requestSync();
  announceConnected();
}

/**
 * Adopt the desktop shell's folder, choosing one if none is remembered.
 *
 * The renderer never names a path: it asks for a dialog, and the main process
 * keeps the answer. `false` means there is no desktop shell, or the user
 * dismissed the dialog. Otherwise the answer carries the shell's warnings
 * (the folder is not watched, or could not be remembered) for the page to show.
 */
export async function chooseDesktopFolder(options: {
  /** Set the git preference for this folder; omitted, the preference is left as it is. */
  git?: boolean;
  /** Take up the remembered folder instead of opening a dialog. */
  reuse?: boolean;
  /** Try the remembered folder again after it was not available. */
  retry?: boolean;
}): Promise<false | { warnings: readonly string[] }> {
  const bridge = desktop();
  if (!bridge) return false;
  const root = options.retry
    ? ((await bridge.retryVaultRoot?.()) ?? null)
    : options.reuse
      ? await bridge.vaultRoot()
      : await bridge.chooseVaultRoot();
  if (!root) return false;
  return await connectDesktopFolder(bridge, root, options);
}

/**
 * The first-open question's Skip: the workspace goes into `WeaveForge` in the
 * reader's Documents folder. Same connection as a pick; the git preference is
 * left alone. `false` when there is no desktop shell or Skip is not offered.
 */
export async function skipDesktopFolder(): Promise<false | { warnings: readonly string[] }> {
  const bridge = desktop();
  if (!bridge?.skipWorkspaceFolder) return false;
  const root = await bridge.skipWorkspaceFolder();
  if (!root) return false;
  return await connectDesktopFolder(bridge, root, {});
}

async function connectDesktopFolder(
  bridge: NonNullable<ReturnType<typeof desktop>>,
  root: DesktopVaultRoot,
  options: { git?: boolean; reuse?: boolean; retry?: boolean },
): Promise<{ warnings: readonly string[] }> {
  // A folder already open is torn down first: its held outside edits, its waiting
  // auto-apply and its pending assets belong to that folder, not the new one.
  if (activeFs) closeFolder();
  activeFs = new DesktopWorkspaceFs(bridge);
  // No git in here for a desktop folder. The shell has the machine's own git
  // and, more to the point, can see what is *above* the folder -- which is the
  // only way to notice that it sits inside somebody else's repository and
  // decline to commit into it. A git driven from the renderer sees the folder
  // and nothing around it.
  activeGit = new NoOpWorkspaceGit();
  // Remembered by the shell rather than by this module, so a folder taken back
  // up on the next launch keeps the history it was connected with. Only a
  // fresh choice says anything about it: reconnecting is not an answer to the
  // question, and must not be read as switching it off.
  if (options.git !== undefined && !options.reuse && !options.retry) {
    await bridge.writePreference("vault-git", options.git);
  }
  watchForChanges();
  // The folder is where the desktop copy keeps its PDFs; fill it in the
  // background so the papers open from disk, offline included.
  downloadLibraryPdfsOnce();
  // And write the workspace out now. Reconnecting the remembered folder on
  // every launch lands here too, which is what keeps the folder current across
  // a restart rather than waiting for the next edit.
  requestSync();
  announceConnected();
  return { warnings: root.warnings ?? [] };
}

/** The remembered desktop folder while it is not available (an unplugged drive), or null. */
export async function missingDesktopFolder(): Promise<string | null> {
  return (await desktop()?.missingVaultRoot?.()) ?? null;
}

/**
 * Disconnect the folder: stop syncing here, and on the desktop also stop the
 * shell watching and remembering it. The files on disk stay. Answers the
 * shell's warnings.
 */
export async function disconnectFolder(): Promise<readonly string[]> {
  const desktopFolder = activeFs instanceof DesktopWorkspaceFs;
  closeFolder();
  if (!desktopFolder) return [];
  return (await desktop()?.forgetVaultRoot?.()) ?? [];
}

/** Fall back to origin-private storage where the picker is unavailable. */
export async function openBrowserStorageFolder(options: { git: boolean }): Promise<void> {
  adoptBrowserFolder(await BrowserWorkspaceFs.openOpfs(), options.git);
}

export function closeFolder(): void {
  activeFs = null;
  activeGit = new NoOpWorkspaceGit();
  syncs.cancel();
  unwatch?.();
  unwatch = null;
  unwatchFolder?.();
  unwatchFolder = null;
}

/** What one folder sync did: the commit it made, if any, or why it could not. */
export interface SyncOutcome {
  commit: WorkspaceCommit | null;
  commitError?: string;
}

/**
 * Commit the folder if versioning is on.
 *
 * The files are the workspace: the app writes them as it saves, so a sync only
 * records them. A folder with nothing changed produces no commit.
 */
export function syncToFolder(): Promise<SyncOutcome> {
  // Under the folder lock, so a git pull or push is never moving the files this commits.
  return folderLock.run(runSyncToFolder);
}

async function runSyncToFolder(): Promise<SyncOutcome> {
  if (!activeFs) throw new Error("No folder is connected.");
  let commit: WorkspaceCommit | null = null;
  let commitError: string | undefined;
  const shell = folderSession()?.kind === "desktop" ? desktop() : null;
  if (shell) {
    // The shell reads the setting itself and answers with a reason when it declined.
    const result = await shell.commitVault().catch((error: unknown) => ({ commit: null, reason: String(error) }));
    commit = result.commit ?? null;
    // History switched off is a choice, not a failure worth a line. The text is
    // wf-core's GIT_OFF (git_gate.rs); the Rust verdict is the only source of it.
    if (!commit && result.reason && result.reason !== "Folder history is switched off.") commitError = result.reason;
  } else if (activeGit.kind !== "none") {
    if (!(await activeGit.isRepo())) await activeGit.init();
    const status = await activeGit.status();
    const core = await loadCore();
    commit = await activeGit.commitAll(core.describeChanges(status), {
      name: "WeaveForge",
      email: "workspace@weaveforge.local",
    });
  }

  if (commit) notifyEach(commitListeners, "vault-commit");
  return { commit, commitError };
}

const commitListeners = new Set<() => void>();

/** Called after each sync that made a folder commit; git auto-sync pushes it. */
export function onVaultCommit(listener: () => void): () => void {
  commitListeners.add(listener);
  return () => commitListeners.delete(listener);
}

export const SYNC_DEBOUNCE_MS = 1_500;

/**
 * The pacing for `requestSync`, built once and reused for every folder.
 *
 * A sync failure is logged rather than thrown to the caller: `requestSync`
 * is called from save paths, and a folder that cannot be written must not take
 * the save down with it.
 */
const syncs: Coalescer = createCoalescer({
  debounceMs: SYNC_DEBOUNCE_MS,
  run: async () => {
    if (!activeFs) return;
    await syncToFolder();
  },
  onError: reportSyncError,
});

/**
 * Log a folder sync that failed, for the app log. No open project is not a
 * failure: there is nothing to commit yet, so it is not logged.
 */
export function reportSyncError(error: unknown): void {
  if (isNoActiveProject(error)) return;
  logToApp({ level: "warn", source: "workspace-sync", message: "Folder sync failed", detail: formatError(error) });
}

/**
 * Ask for a sync. Cheap enough to call on every save.
 *
 * This is the continuous half: `watchForChanges` subscribes it to
 * `onWorkspaceChange`, which every write announces through the backend, so the
 * folder follows the workspace with no button pressed.
 */
export function requestSync(): void {
  if (!activeFs) return;
  syncs.request();
}

/**
 * Follow the workspace while a folder is connected.
 *
 * Subscribed when a folder is opened rather than when this module loads: a
 * listener that ran with no folder would debounce, wake, find nothing to write,
 * and go back to sleep on every edit the user makes for the rest of the
 * session.
 */
let unwatch: (() => void) | null = null;

let unwatchFolder: (() => void) | null = null;

function watchForChanges(): void {
  unwatch?.();
  unwatch = onWorkspaceChange(() => requestSync());
  watchFolderForChanges();
}

const takenInListeners = new Set<(count: number) => void>();

/** Hear how many files changed in the folder from outside the app, each time some did. */
export function onOutsideEditsTakenIn(listener: (count: number) => void): () => void {
  takenInListeners.add(listener);
  return () => takenInListeners.delete(listener);
}

/**
 * Listen to the shell's folder watcher, where there is one.
 *
 * A browser has nothing to subscribe to: it cannot watch a directory it was
 * handed, which is why the workspace port has no watch method to fake.
 */
function watchFolderForChanges(): void {
  unwatchFolder?.();
  unwatchFolder = null;
  const bridge = desktop();
  if (!bridge || folderSession()?.kind !== "desktop") return;
  const stopChanges = bridge.onVaultChange((paths) => {
    void reportFolderChanges(paths);
  });
  const stopLoss = watchForLoss(bridge);
  unwatchFolder = () => {
    stopChanges();
    stopLoss();
  };
}

/** The key DesktopWorkspaceFs records a write under; an unsafe path was never written by the app. */
function recordedAs(path: string): string {
  try {
    return safeWorkspacePath(path);
  } catch {
    return path;
  }
}

/**
 * What to do about the paths the shell says changed.
 *
 * The app's own machinery is never an edit to report (`triageReportedPaths`), and
 * neither is the app's own write echoing back: a file still holding what the app
 * last wrote there is skipped. What is left changed outside the app. The files are
 * the store, so there is nothing to import: it is announced, and committed.
 */
function reportFolderChanges(paths: readonly string[]): void {
  // Before anything reads them: a cached read would hide the edit being reported.
  forgetVaultPaths(paths);
  let projectId: string | null = null;
  try {
    projectId = getContainer().projects.context.projectId ?? null;
  } catch {
    projectId = null;
  }
  const { drafts, candidates } = readyCore().triageReportedPaths({ paths, projectId });
  if (drafts) for (const listener of [...draftListeners]) listener();
  if (candidates.length === 0) return;

  void (async () => {
    // A pull moves files under the lock; read them once it is done.
    await folderLock.idle();
    const fs = activeFs;
    if (!fs) return;
    let outside = 0;
    for (const path of candidates) {
      const text = await fs.readText(path).catch(() => null);
      // Unreadable: a directory event or a removal, nothing to announce.
      if (text === null || isOwnWrite(recordedAs(path), text)) continue;
      outside += 1;
    }
    // Folder closed meanwhile: these belong to a folder no longer shown.
    if (activeFs !== fs || outside === 0) return;
    notifyEach(takenInListeners, "outside-edits-taken-in", outside);
    requestSync();
  })().catch((error: unknown) => {
    console.warn("Could not check folder changes:", error);
  });
}

const draftListeners = new Set<() => void>();

/** Called when the local MCP leaves or changes a suggestion in the folder. */
export function onFolderDraftsChanged(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => draftListeners.delete(listener);
}

export async function folderHistory(limit = 20): Promise<readonly WorkspaceCommit[]> {
  // Desktop commits in the shell; the renderer's git is a no-op there.
  const shell = folderSession()?.kind === "desktop" ? desktop() : null;
  // A log that cannot be read is an error the panel shows, not an empty history.
  if (shell) return shell.vaultLog(limit);
  return activeGit.log({ limit });
}

/** Earlier versions of the connected folder's files, or null with no folder or an old shell. */
export function folderFileHistory(): FileHistorySource | null {
  const session = folderSession();
  if (!session) return null;
  if (session.kind !== "desktop") return gitFileHistory(activeGit);
  const shell = desktop();
  return shell ? shellFileHistory(shell) : null;
}

/**
 * Write a file back into the folder as it was at `oid`.
 *
 * The file is the workspace's copy, so the old version is back as soon as it is written.
 */
export async function restoreFolderFile(oid: string, path: string): Promise<void> {
  const source = folderFileHistory();
  if (!activeFs || !source) throw new Error("No folder is connected.");
  const text = await source.readAt(oid, path);
  if (text === null) throw new Error("That version is not text, so it cannot be restored here.");
  await activeFs.writeFile(path, text);
}

