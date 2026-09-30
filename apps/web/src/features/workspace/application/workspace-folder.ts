import {
  ASSET_DIR,
  FOLDER_DRAFTS_DIR,
  NoOpWorkspaceGit,
  WORKSPACE_META_DIR,
  changedSide,
  addCounts,
  countJsonActions,
  describeChanges,
  diffJsonData,
  diffWorkspace,
  isAppOwnedPath,
  jsonDataPath,
  jsonKindOfPath,
  parseJsonData,
  projectDir,
  fromRelativeBlobLinks,
  readFrontmatter,
  mergeVaultPage,
  mirrorWorkspace,
  parseWorkspaceFolder,
  serializeWorkspace,
  vaultPageSide,
  type ImportDiff,
  type ImportDiffEntry,
  type IWorkspaceFs,
  type IWorkspaceGit,
  type MirrorResult,
  type VaultPageBase,
  type JsonDiff,
  type JsonDiffEntry,
  type JsonRow,
  type PaperRelation,
  type ReadingListItem,
  type Tag,
  type WorkspaceCommit,
  type WorkspaceJsonKind,
  type WorkspaceProject,
  type WorkspaceSnapshot,
  JSON_KINDS,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { downloadLibraryPdfsOnce } from "@/features/reader/application/download-library-pdfs";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { onWorkspaceChange } from "@/lib/workspace-changes";
import { BrowserWorkspaceFs } from "../infrastructure/browser-workspace-fs";
import { DesktopWorkspaceFs } from "../infrastructure/desktop-workspace-fs";
import { IsomorphicWorkspaceGit } from "../infrastructure/isomorphic-workspace-git";
import {
  assetExtension,
  assetMimeType,
  ownedAssetFolderPaths,
  planAssetReanchor,
  workspaceBodies,
} from "./asset-reanchor";
import {
  MIRROR_MANIFEST_PATH,
  baseDigest,
  jsonEditSince,
  claimImportedFile,
  createCoalescer,
  nextManifest,
  readMirrorBase,
  readMirrorBases,
  writeMirrorManifest,
  type Coalescer,
} from "./mirror-manifest";
import { activeProject, activeProjectOrNull } from "./active-project";
import { applyJsonEntries, jsonDiff, refreshMirrorBase } from "./folder-json-import";
import {
  IMPORT_LIMITS,
  ImportLimitError,
  sanitizeArchiveEntries,
  stripArchiveRoot,
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



/**
 * Asset bytes from the most recent preview, keyed by folder path.
 *
 * Held between preview and apply because the preview must not upload anything —
 * looking at a diff is not consent to write — and by apply time the archive is
 * long gone. Cleared when the import is applied or the folder is closed.
 */
let pendingAssets = new Map<string, Uint8Array>();

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
  for (const listener of [...connectedListeners]) {
    try {
      listener();
    } catch {
      /* a listener's problem is its own */
    }
  }
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
  activeFs = fs;
  activeGit = options.git ? new IsomorphicWorkspaceGit(fs) : new NoOpWorkspaceGit();
  watchForChanges();
  // Connecting a folder starts the mirror rather than waiting for the next
  // write: the workspace is usually not empty, and an empty folder after
  // connecting reads as a failed connection. See `requestSync`'s own comment.
  requestSync();
  announceConnected();
  return true;
}

/**
 * Adopt the desktop shell's folder, choosing one if none is remembered.
 *
 * The renderer never names a path: it asks for a dialog, and the main process
 * keeps the answer. `false` means there is no desktop shell, or the user
 * dismissed the dialog.
 */
export async function chooseDesktopFolder(options: {
  git: boolean;
  /** Take up the remembered folder instead of opening a dialog. */
  reuse?: boolean;
}): Promise<boolean> {
  const bridge = desktop();
  if (!bridge) return false;
  const root = options.reuse ? await bridge.vaultRoot() : await bridge.chooseVaultRoot();
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
  if (!options.reuse) await bridge.writePreference("vault-git", options.git);
  watchForChanges();
  // The folder is where the desktop copy keeps its PDFs; fill it in the
  // background so the papers open from disk, offline included.
  downloadLibraryPdfsOnce();
  // And write the workspace out now. Reconnecting the remembered folder on
  // every launch lands here too, which is what keeps the folder current across
  // a restart rather than waiting for the next edit.
  requestSync();
  announceConnected();
  return true;
}

/** Fall back to origin-private storage where the picker is unavailable. */
export async function openBrowserStorageFolder(options: { git: boolean }): Promise<void> {
  const fs = await BrowserWorkspaceFs.openOpfs();
  activeFs = fs;
  activeGit = options.git ? new IsomorphicWorkspaceGit(fs) : new NoOpWorkspaceGit();
  watchForChanges();
  requestSync();
  announceConnected();
}

export function closeFolder(): void {
  activeFs = null;
  activeGit = new NoOpWorkspaceGit();
  syncs.cancel();
  unwatch?.();
  unwatch = null;
  unwatchFolder?.();
  unwatchFolder = null;
  clearExternalChanges();
  pendingAssets = new Map();
}

export interface SyncOutcome {
  mirror: MirrorResult;
  commit: WorkspaceCommit | null;
}

/**
 * Write the workspace to the folder, then commit if versioning is on.
 *
 * Unchanged files are skipped, so a sync with nothing to do writes nothing and
 * produces no commit — which is what keeps the history readable.
 */
export async function syncToFolder(): Promise<SyncOutcome> {
  if (!activeFs) throw new Error("No folder is connected.");
  const fs = activeFs;
  const container = getContainer();
  const project = await activeProject();
  const projectRoot = projectDir(project);
  const snapshot = await container.workspace.snapshot();
  // This project's manifest, and only this project's: the paths in it are the
  // files the removal pass below is allowed to touch.
  const base = await readMirrorBase(fs, projectRoot);
  const previousPaths = Object.keys(base);

  const mirror = await mirrorWorkspace(snapshot, fs, {
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
  const shell = folderSession()?.kind === "desktop" ? desktop() : null;
  if (shell) {
    // The shell reads the setting itself and answers with a reason when it
    // declined, so a folder history that is off -- or refused -- costs the
    // commit and not the mirror run that had already succeeded.
    commit = (await shell.commitVault().catch(() => null))?.commit ?? null;
  } else if (activeGit.kind !== "none") {
    if (!(await activeGit.isRepo())) await activeGit.init();
    const status = await activeGit.status();
    commit = await activeGit.commitAll(describeChanges(status), {
      name: "WeaveForge",
      email: "workspace@weaveforge.local",
    });
  }

  return { mirror, commit };
}

export const SYNC_DEBOUNCE_MS = 1_500;

/**
 * The pacing for `requestSync`, built once and reused for every folder.
 *
 * A mirror failure reaches `syncErrors` rather than the caller: `requestSync`
 * is called from save paths, and a folder that cannot be written must not take
 * the save down with it.
 */
const syncErrors: unknown[] = [];

const syncs: Coalescer = createCoalescer({
  debounceMs: SYNC_DEBOUNCE_MS,
  run: async () => {
    if (!activeFs) return;
    await syncToFolder();
  },
  onError: (error) => {
    syncErrors.push(error);
  },
});

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
 * Reported, never applied. The panel's contract is that pulling changes back is
 * an explicit action with a diff shown first, and applying a folder edit blind
 * would overwrite whatever the workspace holds for that note with no way back
 * -- the three-way merge that would make it safe does not exist yet.
 */
let external = new Set<string>();
const externalListeners = new Set<(paths: string[]) => void>();

/** The paths changed outside the app since the last time they were cleared. */
export function externalChanges(): string[] {
  return [...external].sort();
}

/** Forget them, once the reader has looked. */
export function clearExternalChanges(): void {
  external = new Set();
  announceExternal();
}

export function onExternalChange(listener: (paths: string[]) => void): () => void {
  externalListeners.add(listener);
  return () => externalListeners.delete(listener);
}

function announceExternal(): void {
  const paths = externalChanges();
  for (const listener of [...externalListeners]) {
    try {
      listener(paths);
    } catch {
      // A listener's problem is its own; the folder still changed.
    }
  }
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
  unwatchFolder = bridge.onVaultChange((paths) => {
    void reportFolderChanges(paths);
  });
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
async function reportFolderChanges(paths: readonly string[]): Promise<void> {
  const before = external.size;
  let drafts = false;
  const jsonCandidates: string[] = [];
  for (const path of paths) {
    // MCP suggestions go to the review queue, not the changed-files list.
    if (path.startsWith(`${FOLDER_DRAFTS_DIR}/`)) drafts = true;
    else if (isAppOwnedPath(path)) continue;
    // Markdown is reported at once — nothing else has to be read to know it is
    // somebody's edit. A JSON data file is reported below, once the manifest has
    // said whether the app is the one that wrote it.
    else if (jsonKindOfPath(path) !== null) jsonCandidates.push(path);
    else external.add(path);
  }

  if (external.size !== before) announceExternal();
  if (drafts) for (const listener of [...draftListeners]) listener();
  if (jsonCandidates.length === 0) return;

  const fs = activeFs;
  const project = await activeProjectOrNull().catch(() => null);
  const base = fs && project ? await readMirrorBase(fs, projectDir(project)) : {};
  const beforeJson = external.size;
  for (const path of jsonCandidates) {
    if (fs) {
      const text = await fs.readText(path).catch(() => null);
      if (text !== null && !jsonEditSince(base, path, text)) continue;
    }
    external.add(path);
  }
  if (external.size !== beforeJson) announceExternal();
}

const draftListeners = new Set<() => void>();

/** Called when the local MCP leaves or changes a suggestion in the folder. */
export function onFolderDraftsChanged(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => draftListeners.delete(listener);
}

export async function folderHistory(limit = 20): Promise<readonly WorkspaceCommit[]> {
  return activeGit.log({ limit });
}

/**
 * Read the connected folder and diff it against the workspace.
 *
 * Preview only — nothing is written. This is the "edit in Obsidian, pull back
 * in" direction, and seeing "12 updated, 1 conflict" before committing to it is
 * the whole point.
 */
export async function previewFolderImport(): Promise<ImportDiff & { json: JsonDiff }> {
  if (!activeFs) throw new Error("No folder is connected.");

  const files: Record<string, string> = {};
  const assets = new Map<string, Uint8Array>();
  let assetBytes = 0;
  const project = await activeProject();
  const projectRoot = projectDir(project);
  const base = await readMirrorBase(activeFs, projectRoot);
  const bases = await readMirrorBases(activeFs, projectRoot);

  const jsonFiles: Record<string, string> = {};
  for await (const entry of activeFs.walk("")) {
    if (entry.path.endsWith(".md")) {
      files[entry.path] = await activeFs.readText(entry.path);
      continue;
    }
    // The project's own three data files. Read from the folder rather than
    // assumed, so a file somebody added by hand is diffed like any other.
    if (entry.path.endsWith(".json") && jsonKindOfPath(entry.path) !== null) {
      jsonFiles[entry.path] = await activeFs.readText(entry.path);
      continue;
    }
    if (!entry.path.startsWith(`${ASSET_DIR}/`)) continue;
    const bytes = await activeFs.readFile(entry.path);
    if (bytes.byteLength > IMPORT_LIMITS.maxFileBytes) continue;
    assetBytes += bytes.byteLength;
    if (assetBytes > IMPORT_LIMITS.maxTotalBytes) {
      throw new ImportLimitError(
        `Folder assets exceed ${Math.round(IMPORT_LIMITS.maxTotalBytes / 1024 / 1024)} MB; refusing to continue.`,
      );
    }
    assets.set(entry.path, bytes);
  }

  return diffAgainstWorkspace(files, assets, project, base, bases, jsonFiles);
}

/** Diff a ZIP the user picked, without connecting a folder. */
export async function previewArchiveImport(
  bytes: Uint8Array,
): Promise<ImportDiff & { skipped: string[]; json: JsonDiff }> {
  const { unzipSync } = await import("fflate");
  const { safe, skipped } = sanitizeArchiveEntries(unzipSync(bytes));
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
    skipped,
  };
}

async function diffAgainstWorkspace(
  files: Record<string, string>,
  assets: Map<string, Uint8Array>,
  /**
   * The project being compared. The paths the mirror would write are inside its
   * folder, so the same file in two projects is two different paths.
   */
  project: WorkspaceProject,
  /**
   * What the folder said when the two sides last agreed, by path.
   *
   * Absent for an archive import: a ZIP has no shared history with this
   * workspace, so every difference is the user's to judge.
   */
  base: Readonly<Record<string, string>> = {},
  /** Frontmatter and body digests from the same manifest, for the merge. */
  bases: Readonly<Record<string, VaultPageBase>> = {},
  /** The three JSON data files, when the caller has them. A ZIP has none. */
  jsonFiles: Record<string, string> = {},
): Promise<ImportDiff & { json: JsonDiff }> {
  const snapshot = await getContainer().workspace.snapshot();
  const existing = [
    ...snapshot.vaultPages.map((page) => ({
      id: page.id,
      type: "vault_page" as const,
      title: page.title,
      body: page.body,
    })),
    ...snapshot.papers.map((paper) => ({
      id: paper.id,
      type: "paper" as const,
      title: paper.title,
      body: paper.summary ?? "",
    })),
  ];

  pendingAssets = assets;
  const owned = ownedAssetFolderPaths(workspaceBodies(snapshot));
  const parsed = parseWorkspaceFolder(files).map((entity) => ({
    ...entity,
    // Restore links to assets this account already owns before comparing.
    // Without it every note holding an image reads as changed on every import,
    // because the folder spells the reference `../assets/…` and the database
    // spells the same reference `vault:…`.
    body: fromRelativeBlobLinks(entity.body, {
      resolve: (scope, path) => (owned.has(`${ASSET_DIR}/${scope}/${path}`) ? path : null),
    }),
  }));

  // What the mirror would write from the workspace as it stands now. Compared
  // against the same base as the folder's copy, this is what says whether the
  // difference came from out there or in here.
  const current = serializeWorkspace(snapshot, project).files;

  const diff = diffWorkspace(parsed, existing, {
    origin: (path) =>
      changedSide({
        // A version 1 manifest recorded the path and no digest, which reads
        // as an empty string here and must not be mistaken for a file whose
        // contents hashed to nothing.
        base: base[path] || undefined,
        folder: files[path] === undefined ? undefined : baseDigest(files[path]),
        workspace: current[path] === undefined ? undefined : baseDigest(current[path]),
      }),
  });

  // A file both sides changed is only a conflict if the changes collide. Most
  // do not: a tag added in Obsidian and a paragraph rewritten here are two
  // edits to one note, not two answers to one question.
  const entries = diff.entries.map((entry) =>
    mergeBothChanged(entry, bases[entry.entity.path], current[entry.entity.path]),
  );

  // The JSON data files are the same question asked of rows rather than prose,
  // and they are shown in the same preview: one list of what would change, one
  // set of numbers.
  const json = await jsonDiff(jsonFiles, current, base, project);
  return { entries, counts: addCounts(countActions(entries), json.counts), json };
}


import {
  countActions,
  keepBothTitle,
  mergeBothChanged,
  settleConflict,
  writeConflictMarkersTo,
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

/**
 * Apply an import.
 *
 * Only notes are written. Papers, experiments, and the rest carry structured
 * fields that a markdown body cannot round-trip faithfully, and half-importing
 * a paper — body updated, metadata silently stale — is worse than not
 * importing it.
 *
 * A conflict is applied only where the caller says how to settle it, and
 * `keep` is the default: a file both sides changed is never written over on a
 * guess.
 */
export async function applyFolderImport(
  diff: ImportDiff & { json?: JsonDiff },
  resolutions: Readonly<Record<string, ConflictResolution>> = {},
): Promise<{ created: number; updated: number }> {
  // The mirror stands down for the duration. Every write below changes the
  // workspace, and a sync waking up halfway through would write the folder from
  // a half-imported snapshot — then be asked to import that back.
  syncs.suspended = true;
  try {
    const result = await applyEntries(diff, resolutions);
    const appliedJson = await applyJsonEntries(diff.json);
    // What was applied, the two sides now agree on: the folder's text becomes
    // the base, or the mirror would keep holding those files back for an edit
    // that has already landed.
    await refreshMirrorBase(activeFs, [
      ...diff.entries.filter((entry) => entry.action === "created" || entry.action === "updated").map((entry) => entry.entity.path),
      ...appliedJson,
    ]);
    return result;
  } finally {
    syncs.suspended = false;
    requestSync();
  }
}

/** See `writeConflictMarkersTo`: this window's folder gets the markers. */
export function writeMarkersFor(entry: ImportDiffEntry): Promise<boolean> {
  const fs = activeFs;
  return fs ? writeConflictMarkersTo(fs, entry) : Promise.resolve(false);
}

async function applyEntries(
  diff: ImportDiff,
  resolutions: Readonly<Record<string, ConflictResolution>>,
): Promise<{ created: number; updated: number }> {
  const container = getContainer();
  // Read once: the set only has to describe the workspace as it stood before
  // the import, and re-reading it per note would be a request per note.
  const owned = ownedAssetFolderPaths(workspaceBodies(await container.workspace.snapshot()));
  // A claimed file joins *this* project's manifest, so the next mirror for it
  // removes the hand-written copy the same way it removes any file it replaced.
  const projectRoot = projectDir(await activeProject());
  let created = 0;
  let updated = 0;

  // Only text is written here. An ink note's strokes are pages in `.ink/<id>/`,
  // written by the chunk store and never by the mirror, so settling a conflict
  // decides the note's text and leaves every page of handwriting alone: both
  // sides' strokes stay and are drawn together.
  for (const raw of diff.entries) {
    if (raw.entity.type !== "vault_page") continue;
    if (raw.action === "unchanged") continue;

    const entry = settleConflict(raw, resolutions);
    if (!entry) continue;

    if (entry.action === "created") {
      // The page has to exist before its images can be uploaded — storage keys
      // are `{userId}/{pageId}/…`, so there is no id to file them under until
      // the row is written. The body lands relative, then gets rewritten.
      const page = await container.vault.manageVaultPage.add({
        title: entry.entity.title,
        body: entry.entity.body,
      });
      const body = await reanchorAssets(entry.entity.body, page.id, owned);
      if (body !== entry.entity.body) {
        await container.vault.manageVaultPage.update(page.id, { title: page.title, body });
      }
      // The file it came from now belongs to that page, so say so in the file.
      // Skipped for an archive import, which has no folder to write back to.
      if (activeFs && entry.entity.path) {
        await claimImportedFile(activeFs, entry.entity.path, page.id, projectRoot).catch(
          () => false,
        );
      }
      created += 1;
      continue;
    }

    if (!entry.entity.id) continue;
    const page = await container.vault.getPage(entry.entity.id);
    if (!page) continue;
    await container.vault.manageVaultPage.update(page.id, {
      title: entry.entity.title,
      body: await reanchorAssets(entry.entity.body, page.id, owned),
    });
    updated += 1;
  }

  pendingAssets = new Map();
  return { created, updated };
}

/**
 * Turn an imported body's relative image links back into storage references.
 *
 * The decision of what may resolve lives in `planAssetReanchor`; this only
 * carries it out. Anything the plan leaves unresolved stays as written, which
 * renders as a broken image — visible and harmless, unlike a fabricated key
 * that happens to resolve to someone else's object.
 */
async function reanchorAssets(
  body: string,
  pageId: string,
  owned: ReadonlySet<string>,
): Promise<string> {
  const plan = planAssetReanchor(body, owned, new Set(pendingAssets.keys()));
  if (plan.keep.length === 0 && plan.upload.length === 0) return body;

  const resolved = new Map<string, string>();
  for (const ref of plan.keep) resolved.set(ref.folderPath, ref.storagePath);

  for (const ref of plan.upload) {
    const bytes = pendingAssets.get(ref.folderPath)!;
    const ext = assetExtension(ref.storagePath);
    const blob = new Blob([bytes as BlobPart], { type: assetMimeType(ext) });
    resolved.set(ref.folderPath, await getContainer().vault.uploadAsset(pageId, blob, ext));
  }

  return fromRelativeBlobLinks(body, {
    resolve: (scope, path) => resolved.get(`${ASSET_DIR}/${scope}/${path}`) ?? null,
  });
}

