import {
  ASSET_DIR,
  FOLDER_DRAFTS_DIR,
  NoOpWorkspaceGit,
  idSuffix,
  type ImportDiff,
  type IWorkspaceFs,
  type IWorkspaceGit,
  type MirrorResult,
  type JsonDiff,
  type WorkspaceCommit,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { downloadLibraryPdfsOnce } from "@/features/reader/application/download-library-pdfs";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import { notifyEach } from "@/lib/notify-each";
import { loadCore, readyCore } from "@/lib/rust-core";
import { onWorkspaceChange } from "@/lib/workspace-changes";
import { BrowserWorkspaceFs } from "../infrastructure/browser-workspace-fs";
import { DesktopWorkspaceFs } from "../infrastructure/desktop-workspace-fs";
import { gitFileHistory, shellFileHistory, type FileHistorySource } from "./folder-file-history";
import { IsomorphicWorkspaceGit } from "../infrastructure/isomorphic-workspace-git";
import {
  jsonEditSince,
  createCoalescer,
  followProjectRename,
  nextManifest,
  readMirrorBase,
  readMirrorBases,
  writeMirrorManifest,
  type Coalescer,
} from "./mirror-manifest";
import { activeProject, activeProjectOrNull } from "./active-project";
import { mirrorWorkspace } from "./folder-mirror";
import { watchForLoss } from "./folder-watch-lost";
import { readPreviewFolder } from "./folder-preview-read";
import { applyFolderImport, keepWorkspaceCopy } from "./folder-import-apply";
import { isNoteOpen, onNoteClosed } from "./open-notes";
import { diffAgainstWorkspace, importableEntities } from "./folder-diff";
import {
  applyOutsideEdits,
  renamedPaths,
  splitOutsideEdits,
  type FolderDiff,
  type HeldReason,
  type HeldReasons,
} from "./outside-edits";
import {
  sanitizeArchiveEntries,
  SKIP_TOO_BIG,
  stripArchiveRoot,
  type SkippedFile,
  unzipWithinLimits,
} from "./import-limits";

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
 * The open folder's filesystem, for a feature that keeps files beside the
 * mirror rather than in it — the ink sidecar is the one so far. `null` while
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



import { clearPendingAssets } from "./folder-import-apply";

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
  activeFs = fs;
  activeGit = git ? new IsomorphicWorkspaceGit(fs) : new NoOpWorkspaceGit();
  watchForChanges();
  // Connecting a folder starts the mirror rather than waiting for the next
  // write: the workspace is usually not empty, and an empty folder after
  // connecting reads as a failed connection. See `requestSync`'s own comment.
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
  git: boolean;
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
  if (!options.reuse && !options.retry) await bridge.writePreference("vault-git", options.git);
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
 * Disconnect the folder: stop mirroring here, and on the desktop also stop the
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
  if (autoApplyTimer) clearTimeout(autoApplyTimer);
  autoApplyTimer = null;
  autoApplyFirstAt = null;
  autoApplyPaths = new Set();
  clearExternalChanges();
  clearPendingAssets();
}

export interface SyncOutcome {
  mirror: MirrorResult;
  commit: WorkspaceCommit | null;
  /** Why no commit was made, when git refused or failed. */
  commitError?: string;
}

/** One line for the panel; a failed commit is said, not read as "up to date". */
export function describeSync({ mirror, commit, commitError }: SyncOutcome): string {
  const wrote = `Wrote ${mirror.written.length} file${mirror.written.length === 1 ? "" : "s"}`;
  const removed = mirror.removed.length ? `, removed ${mirror.removed.length}` : "";
  if (commit) return `${wrote}${removed} · committed "${commit.message}".`;
  if (commitError) return `${wrote}${removed} · not committed: ${commitError}`;
  return `${wrote}${removed}${mirror.written.length === 0 ? " — already up to date" : "."}`;
}

/** The sync writing right now; folder events wait for it so its own writes are not reported. */
let syncInFlight: Promise<unknown> = Promise.resolve();

/**
 * Write the workspace to the folder, then commit if versioning is on.
 *
 * Unchanged files are skipped, so a sync with nothing to do writes nothing and
 * produces no commit — which is what keeps the history readable.
 */
export function syncToFolder(): Promise<SyncOutcome> {
  const run = runSyncToFolder();
  syncInFlight = run.catch(() => undefined);
  return run;
}

async function runSyncToFolder(): Promise<SyncOutcome> {
  if (!activeFs) throw new Error("No folder is connected.");
  const fs = activeFs;
  const container = getContainer();
  const project = await activeProject();
  await followProjectRename(fs, project);
  const core = await loadCore();
  const projectRoot = core.projectDir(project);
  const snapshot = await container.workspace.snapshot();
  // This project's manifest, and only this project's: the paths in it are the
  // files the removal pass below is allowed to touch.
  const base = await readMirrorBase(fs, projectRoot);
  const previousPaths = Object.keys(base);

  const mirror = await mirrorWorkspace(core, snapshot, fs, {
    project,
    previousPaths,
    // The digests, not only the paths: a file whose content has moved on since
    // the app wrote it is the reader's, and the mirror must not write over it
    // before the import has had the chance to offer it.
    base,
    fetchAsset: async (storagePath) => {
      const blobs = await container.vault.fetchAssetBlobs([storagePath]);
      const blob = blobs.get(storagePath);
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    },
  });
  await writeMirrorManifest(
    fs,
    projectRoot,
    nextManifest(previousPaths, mirror),
    mirror.mirrored,
    mirror.bases,
  );

  // Files left as the folder has them, because they changed since the app wrote
  // them. They belong in the same list the folder watcher feeds — they are
  // outside changes — so a sync that changed nothing does not read as a clean
  // one while a reader's edit waits to be applied.
  if (mirror.heldBack.length > 0) {
    for (const path of mirror.heldBack) external.add(path);
    announceExternal();
  }

  let commit: WorkspaceCommit | null = null;
  let commitError: string | undefined;
  const shell = folderSession()?.kind === "desktop" ? desktop() : null;
  if (shell) {
    // The shell reads the setting itself and answers with a reason when it
    // declined, so a folder history that is off -- or refused -- costs the
    // commit and not the mirror run that had already succeeded.
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

  return { mirror, commit, commitError };
}

export const SYNC_DEBOUNCE_MS = 1_500;

/**
 * The pacing for `requestSync`, built once and reused for every folder.
 *
 * A mirror failure is logged rather than thrown to the caller: `requestSync`
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

/** Log a folder sync that failed, for the app log. */
export function reportSyncError(error: unknown): void {
  logToApp({ level: "warn", source: "workspace-sync", message: "Folder sync failed", detail: formatError(error) });
}

/**
 * Ask for a sync. Cheap enough to call on every save.
 *
 * This is the continuous half: `watchForChanges` subscribes it to
 * `onWorkspaceChange`, which every write announces through the backend, so the
 * folder follows the workspace with no button pressed. The button in Settings is
 * then "write it now" rather than the only way anything reaches the disk. The
 * copy in the panel says that, and used to say the opposite.
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

/**
 * Somebody else's edits to the connected folder, by path.
 *
 * An edit made only in the folder is taken in a moment later with no click (`scheduleAutoApply`). What is
 * left here is what a person has to look at: a file the app also changed, a removal, a file the app has
 * no record of writing, or a note open in an editor.
 */
let external = new Set<string>();
/** Why each listed path waits for review. */
let externalReasons: HeldReasons = {};
const externalListeners = new Set<(paths: string[]) => void>();
const takenInListeners = new Set<(count: number) => void>();
/** Wait after the last outside edit before taking edits in, so a burst of saves is read once. */
export const AUTO_APPLY_DEBOUNCE_MS = 800;
/** Longest a waiting edit is put off by later ones, so a folder that never goes quiet is still read. */
export const AUTO_APPLY_MAX_WAIT_MS = 2000;
let autoApplyTimer: ReturnType<typeof setTimeout> | null = null;
/** When the waiting auto-apply was first asked for; null when none waits. */
let autoApplyFirstAt: number | null = null;
let autoApplyRun: Promise<unknown> = Promise.resolve();
/** The paths seen changing since the last auto-apply started; the next one previews only these. */
let autoApplyPaths = new Set<string>();

/** Whether an auto-apply is waiting for its debounce; tests use it to see a close cancel one. */
export function autoApplyScheduled(): boolean {
  return autoApplyTimer !== null;
}

/** The paths changed outside the app since the last time they were cleared. */
export function externalChanges(): string[] {
  return [...external].sort();
}

/** Forget them, once the reader has looked. */
export function clearExternalChanges(): void {
  external = new Set();
  externalReasons = {};
  announceExternal();
}

/**
 * After a preview, keep only what it found changed: the button's count then matches the diff.
 *
 * A preview of `only` some paths settles those; the rest of the list stays as it was.
 */
export function settleExternalChanges(diff: FolderDiff, only?: ReadonlySet<string>): void {
  const changed = new Set<string>();
  for (const entry of diff.entries) if (entry.action !== "unchanged") changed.add(entry.entity.path);
  for (const entry of diff.json?.entries ?? []) if (entry.action !== "unchanged") changed.add(entry.path);
  const reasons = splitOutsideEdits(diff, isNoteOpen).reasons;
  if (only) {
    for (const path of external) if (!only.has(path)) changed.add(path);
    const kept = Object.entries(externalReasons).filter(([path]) => !only.has(path));
    externalReasons = { ...Object.fromEntries(kept), ...reasons };
  } else {
    externalReasons = reasons;
  }
  external = changed;
  announceExternal();
}

export function onExternalChange(listener: (paths: string[]) => void): () => void {
  externalListeners.add(listener);
  return () => externalListeners.delete(listener);
}

/**
 * Settle one held outside edit from its row: "mine" writes the workspace's copy over the folder's file,
 * "theirs" takes the folder's copy in. The path is then looked at again, so the list drops it.
 */
export async function settleHeldEdit(path: string, keep: "mine" | "theirs"): Promise<void> {
  const fs = activeFs;
  if (!fs) throw new Error("No folder is connected.");
  const only = new Set([path]);
  if (keep === "mine") await keepWorkspaceCopy(fs, path);
  else await applyFolderImport(await previewFolderImport(only), { [path]: "folder" }, { fs });
  if (activeFs === fs) settleExternalChanges(await previewFolderImport(only), only);
}

/** Why a listed outside edit waits for review; none for a path the last look did not see. */
export function externalChangeReason(path: string): HeldReason | undefined {
  return externalReasons[path];
}

/** Hear how many outside edits an auto-apply took in, each time it took some. */
export function onOutsideEditsTakenIn(listener: (count: number) => void): () => void {
  takenInListeners.add(listener);
  return () => takenInListeners.delete(listener);
}

function announceExternal(): void {
  // A listener's problem is its own; the folder still changed.
  notifyEach(externalListeners, "external-changes", externalChanges());
}

/**
 * Take the folder's own edits in a moment after they stop, with no click.
 *
 * Only a file the folder alone changed goes in (`splitOutsideEdits`); the rest stays in the list for
 * review. Each run reads only the paths seen changing since the last one started, and a new edit
 * restarts the wait, so a stream of saves is read once it pauses. Runs one at a time; a run whose folder closed or changed meanwhile writes nothing, and a file
 * that moved again after the preview keeps its old base, so the next look sees that edit too.
 */
function scheduleAutoApply(): void {
  if (autoApplyTimer) clearTimeout(autoApplyTimer);
  const now = Date.now();
  autoApplyFirstAt ??= now;
  const delay = Math.min(AUTO_APPLY_DEBOUNCE_MS, Math.max(0, autoApplyFirstAt + AUTO_APPLY_MAX_WAIT_MS - now));
  autoApplyTimer = setTimeout(() => {
    autoApplyTimer = null;
    autoApplyFirstAt = null;
    const fs = activeFs;
    autoApplyRun = autoApplyRun.then(async () => {
      // No check on `external` here: a settle from the run before may have cleared a path that changed
      // while it ran, and this run's fresh preview is what finds it again.
      if (!fs || activeFs !== fs) return;
      const only = autoApplyPaths;
      autoApplyPaths = new Set();
      if (only.size === 0) return;
      try {
        const { applied } = await applyOutsideEdits({
          preview: () => previewFolderImport(only),
          isOpen: isNoteOpen,
          apply: async (diff) => {
            const result = await applyFolderImport(diff, {}, {
        fs,
        expected: seenDigests(diff),
        stored: diff.stored,
        renamed: renamedPaths(diff),
      });
            // A note written in the app since the preview was left alone; the next look sees both sides moved.
            if (result.moved.length > 0) {
              for (const path of result.moved) autoApplyPaths.add(path);
              scheduleAutoApply();
            }
            return result;
          },
          settle: (held) => {
            if (activeFs === fs) settleExternalChanges(held, only);
          },
        });
        if (applied > 0 && activeFs === fs) notifyEach(takenInListeners, "outside-edits-taken-in", applied);
      } catch (error) {
        // The list keeps the paths, so the reader can still review them by hand.
        logToApp({ level: "warn", source: "workspace-sync", message: "outside edits not taken in", detail: formatError(error) });
      }
    });
  }, delay);
}

// An edit held only because its note was open goes in once the note closes, not at the next folder event.
onNoteClosed(() => {
  const waiting = Object.keys(externalReasons).filter((path) => externalReasons[path] === "open in editor");
  if (!activeFs || waiting.length === 0) return;
  for (const path of waiting) autoApplyPaths.add(path);
  scheduleAutoApply();
});

/** The digest the preview read for each file, so the apply can tell a file that moved since. */
function seenDigests(diff: FolderDiff): Record<string, string> {
  return Object.fromEntries(Object.entries(diff.seen ?? {}).map(([path, seen]) => [path, seen.digest]));
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

/**
 * What to do about the paths the shell says changed.
 *
 * The app's own machinery is never an edit to report — the database, its
 * backups, the search cache, the mirror's manifest. The three JSON data files
 * are the reader's, so they *are* reported, with one exception that matters: the
 * mirror rewrites them whenever the data changes, and a report that fired on
 * that would be the app reporting itself. The project's manifest holds the
 * digest of what it wrote, so a file still holding that is its own write.
 */
function reportFolderChanges(paths: readonly string[]): void {
  const before = external.size;
  let drafts = false;
  const candidates: string[] = [];

  let currentIdSuffix: string | null = null;
  try {
    const id = getContainer().projects.context.projectId;
    if (id) currentIdSuffix = idSuffix(id);
  } catch {
    currentIdSuffix = null;
  }

  for (const path of paths) {
    // MCP suggestions go to the review queue, not the changed-files list.
    if (path.startsWith(`${FOLDER_DRAFTS_DIR}/`)) {
      drafts = true;
      continue;
    }
    if (readyCore().isAppOwnedPath(path)) continue;

    // When scoped to a project, ignore outside changes that belong to another project's subfolder:
    const subfolderMatch = path.match(/^[^\/]+--([a-zA-Z0-9]{1,8})\//);
    if (subfolderMatch && currentIdSuffix) {
      if (subfolderMatch[1] !== currentIdSuffix) {
        continue;
      }
    }

    // Notes too: reconnecting rewrites every file, and a slow write outlives the shell's echo window.
    candidates.push(path);
  }

  if (external.size !== before) announceExternal();
  if (drafts) for (const listener of [...draftListeners]) listener();
  if (candidates.length === 0) return;

  void (async () => {
    // A mirror run writes its files before its manifest; checked mid-run, every one reads as foreign.
    await syncInFlight;
    const fs = activeFs;
    const project = await activeProjectOrNull().catch(() => null);
    const base = fs && project ? await readMirrorBase(fs, (await loadCore()).projectDir(project)) : {};
    const beforeRead = external.size;
    let outside = false;
    for (const path of candidates) {
      if (fs) {
        const text = await fs.readText(path).catch(() => null);
        if (text !== null && !jsonEditSince(base, path, text)) continue;
        // Unreadable and never mirrored: a directory event, not a deleted note.
        if (text === null && base[path] === undefined) continue;
      }
      // Folder closed meanwhile: these belong to a folder no longer shown.
      if (activeFs !== fs) return;
      external.add(path);
      autoApplyPaths.add(path);
      outside = true;
    }
    if (external.size !== beforeRead) announceExternal();
    // A path already listed can change again; that edit needs taking in too.
    if (outside) scheduleAutoApply();
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
 * Only the folder changes; the caller then shows the import preview so the
 * reader takes the old version into the workspace, or leaves it.
 */
export async function restoreFolderFile(oid: string, path: string): Promise<void> {
  const source = folderFileHistory();
  if (!activeFs || !source) throw new Error("No folder is connected.");
  const text = await source.readAt(oid, path);
  if (text === null) throw new Error("That version is not text, so it cannot be restored here.");
  await activeFs.writeFile(path, text);
}

/**
 * Read the connected folder and diff it against the workspace.
 *
 * Preview only — nothing is written. This is the "edit in Obsidian, pull back
 * in" direction, and seeing "12 updated, 1 conflict" before committing to it is
 * the whole point.
 */
export async function previewFolderImport(
  only?: ReadonlySet<string>,
): Promise<FolderDiff & { json: JsonDiff; skipped: SkippedFile[] }> {
  if (!activeFs) throw new Error("No folder is connected.");

  const project = await activeProject();
  await followProjectRename(activeFs, project);
  const core = await loadCore();
  const projectRoot = core.projectDir(project);
  const base = await readMirrorBase(activeFs, projectRoot);
  const bases = await readMirrorBases(activeFs, projectRoot);

  const hasProjectDir = (await activeFs.stat(projectRoot).catch(() => null)) !== null;
  const { files, assets, jsonFiles, skipped } = await readPreviewFolder(activeFs, projectRoot, hasProjectDir, only);

  return { ...(await diffAgainstWorkspace(files, assets, project, base, bases, jsonFiles)), skipped };
}

/** Diff a ZIP the user picked, without connecting a folder. */
export async function previewArchiveImport(
  bytes: Uint8Array,
): Promise<ImportDiff & { skipped: SkippedFile[]; json: JsonDiff }> {
  const { entries: inflated, oversize } = await unzipWithinLimits(bytes);
  const { safe, skipped } = sanitizeArchiveEntries(await loadCore(), inflated);
  const entries = stripArchiveRoot(safe);

  const decoder = new TextDecoder();
  const files: Record<string, string> = {};
  const assets = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.path.endsWith(".md")) files[entry.path] = decoder.decode(entry.bytes);
    else if (entry.path.startsWith(`${ASSET_DIR}/`)) assets.set(entry.path, entry.bytes);
  }

  return {
    ...(await diffAgainstWorkspace(files, assets, await activeProject())),
    skipped: [...oversize.map((path) => ({ path, reason: SKIP_TOO_BIG })), ...skipped],
  };
}


import {
  keepBothTitle,
  mergeBothChanged,
  settleConflict,
  type ConflictPicks,
  type ConflictResolution,
} from "./folder-merge";

export {
  keepBothTitle,
  mergeBothChanged,
  settleConflict,
  type ConflictPicks,
  type ConflictResolution,
};

export { applyFolderImport, writeMarkersFor } from "./folder-import-apply";
export { importableEntities };


