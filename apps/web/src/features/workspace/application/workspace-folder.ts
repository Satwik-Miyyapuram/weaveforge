import {
  ASSET_DIR,
  NoOpWorkspaceGit,
  changedSide,
  describeChanges,
  diffWorkspace,
  fromRelativeBlobLinks,
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
  type WorkspaceCommit,
  type WorkspaceSnapshot,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
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
} from "./asset-reanchor";
import {
  MIRROR_MANIFEST_PATH,
  baseDigest,
  createCoalescer,
  nextManifest,
  readMirrorBase,
  readMirrorBases,
  writeMirrorManifest,
  type Coalescer,
} from "./mirror-manifest";
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

/** Pick a real folder. Returns false when the user dismissed the picker. */
export async function chooseFolder(options: { git: boolean }): Promise<boolean> {
  const fs = await BrowserWorkspaceFs.pickDirectory();
  if (!fs) return false;
  activeFs = fs;
  activeGit = options.git ? new IsomorphicWorkspaceGit(fs) : new NoOpWorkspaceGit();
  watchForChanges();
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
  const fs = new DesktopWorkspaceFs(bridge);
  activeFs = fs;
  activeGit = options.git ? new IsomorphicWorkspaceGit(fs) : new NoOpWorkspaceGit();
  watchForChanges();
  return true;
}

/** Fall back to origin-private storage where the picker is unavailable. */
export async function openBrowserStorageFolder(options: { git: boolean }): Promise<void> {
  const fs = await BrowserWorkspaceFs.openOpfs();
  activeFs = fs;
  activeGit = options.git ? new IsomorphicWorkspaceGit(fs) : new NoOpWorkspaceGit();
  watchForChanges();
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
  const snapshot = await container.workspace.snapshot();
  const base = await readMirrorBase(fs);
  const previousPaths = Object.keys(base);

  const mirror = await mirrorWorkspace(snapshot, fs, {
    previousPaths,
    fetchAsset: async (storagePath) => {
      const blobs = await container.vault.fetchAssetBlobs([storagePath]);
      const blob = blobs.get(storagePath);
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    },
  });
  await writeMirrorManifest(fs, nextManifest(previousPaths, mirror), mirror.mirrored, mirror.bases);

  let commit: WorkspaceCommit | null = null;
  if (activeGit.kind !== "none") {
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

/** Ask for a sync. Cheap enough to call on every save. */
export function requestSync(): void {
  if (!activeFs) return;
  syncs.request();
}

/** Stand the mirror down while a read-back is being applied. */
export function suspendSync(suspended: boolean): void {
  syncs.suspended = suspended;
}

/** The most recent mirror failure, for a panel that wants to say so. */
export function lastSyncError(): unknown {
  return syncErrors.at(-1) ?? null;
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
    const before = external.size;
    for (const path of paths) {
      if (path !== MIRROR_MANIFEST_PATH) external.add(path);
    }
    if (external.size !== before) announceExternal();
  });
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
export async function previewFolderImport(): Promise<ImportDiff> {
  if (!activeFs) throw new Error("No folder is connected.");

  const files: Record<string, string> = {};
  const assets = new Map<string, Uint8Array>();
  let assetBytes = 0;
  const base = await readMirrorBase(activeFs);
  const bases = await readMirrorBases(activeFs);

  for await (const entry of activeFs.walk("")) {
    if (entry.path.endsWith(".md")) {
      files[entry.path] = await activeFs.readText(entry.path);
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

  return diffAgainstWorkspace(files, assets, base, bases);
}

/** Diff a ZIP the user picked, without connecting a folder. */
export async function previewArchiveImport(bytes: Uint8Array): Promise<ImportDiff & { skipped: string[] }> {
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

  return { ...(await diffAgainstWorkspace(files, assets)), skipped };
}

async function diffAgainstWorkspace(
  files: Record<string, string>,
  assets: Map<string, Uint8Array>,
  /**
   * What the folder said when the two sides last agreed, by path.
   *
   * Absent for an archive import: a ZIP has no shared history with this
   * workspace, so every difference is the user's to judge.
   */
  base: Readonly<Record<string, string>> = {},
  /** Frontmatter and body digests from the same manifest, for the merge. */
  bases: Readonly<Record<string, VaultPageBase>> = {},
): Promise<ImportDiff> {
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
  const current = serializeWorkspace(snapshot).files;

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
  return { entries, counts: countActions(entries) };
}

function countActions(entries: readonly ImportDiffEntry[]): ImportDiff["counts"] {
  const counts: ImportDiff["counts"] = { created: 0, updated: 0, unchanged: 0, conflict: 0 };
  for (const entry of entries) counts[entry.action] += 1;
  return counts;
}

/**
 * Settle a both-changed file per field, or say what is actually in dispute.
 *
 * The folder's side is taken from the entry rather than re-read from the file,
 * because the entry's body has already had this account's asset links restored
 * -- comparing the raw file would report every note holding an image as
 * rewritten.
 *
 * Anything the merge cannot settle stays a conflict, and a folder with no
 * recorded base -- a manifest older than version 3, or a ZIP -- keeps the
 * behaviour it had: report, and let the user decide.
 */
export function mergeBothChanged(
  entry: ImportDiffEntry,
  base: VaultPageBase | undefined,
  workspaceContent: string | undefined,
): ImportDiffEntry {
  if (entry.action !== "conflict" || entry.kind !== "both-changed") return entry;
  if (!base || workspaceContent === undefined) return entry;

  const workspace = vaultPageSide(entry.entity.path, workspaceContent);
  if (!workspace) return entry;

  const merged = mergeVaultPage(
    base,
    { fields: { ...entry.entity.fields, title: entry.entity.title }, body: entry.entity.body },
    workspace,
  );

  if (merged.conflicts.length > 0) {
    const fields = merged.conflicts.map((conflict) => conflict.field);
    return {
      ...entry,
      conflictFields: fields,
      reason: `${entry.entity.path}: both sides changed ${listFields(fields)}.`,
    };
  }

  const { title, ...fields } = merged.fields;
  return {
    ...entry,
    action: "updated",
    kind: undefined,
    reason: undefined,
    entity: {
      ...entry.entity,
      title: typeof title === "string" ? title : entry.entity.title,
      fields: fields as ImportDiffEntry["entity"]["fields"],
      body: merged.body,
    },
  };
}

function listFields(fields: readonly string[]): string {
  if (fields.length === 1) return fields[0]!;
  return `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
}

/**
 * What to do about a file both sides changed.
 *
 * `keep` leaves the workspace's copy alone, and the next mirror run writes it
 * back over the folder's. `folder` takes the folder's copy, losing the
 * workspace's. `both` imports the folder's copy as a new note and leaves the
 * workspace's untouched, which is the only one of the three that discards
 * nothing -- and the fallback `offline-first-sync.md` already settled on for
 * the database: keep both, tell the user.
 */
export type ConflictResolution = "keep" | "folder" | "both";

/** How the folder's copy is titled when both copies are kept. */
export function keepBothTitle(title: string): string {
  return `${title} (from folder)`;
}

/**
 * Turn a settled conflict into an ordinary entry, or `null` to leave it alone.
 *
 * Separated from applying because applying reaches for the app container on
 * its first line, and this decision -- which is the whole of the conflict
 * policy -- can then be tested without one.
 */
export function settleConflict(
  entry: ImportDiffEntry,
  resolutions: Readonly<Record<string, ConflictResolution>>,
): ImportDiffEntry | null {
  if (entry.action !== "conflict") return entry;

  const asked = resolutions[entry.entity.path] ?? "keep";
  // A type mismatch has nothing to update: the id names a paper or an
  // experiment, so writing the file over it is not on offer whatever the
  // caller asked for. Importing it as a new note still is.
  const resolution = asked === "folder" && entry.kind === "type-mismatch" ? "both" : asked;
  if (resolution === "keep") return null;
  if (resolution === "folder") return { ...entry, action: "updated" };
  return {
    ...entry,
    action: "created",
    entity: { ...entry.entity, id: undefined, title: keepBothTitle(entry.entity.title) },
  };
}

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
  diff: ImportDiff,
  resolutions: Readonly<Record<string, ConflictResolution>> = {},
): Promise<{ created: number; updated: number }> {
  const container = getContainer();
  // Read once: the set only has to describe the workspace as it stood before
  // the import, and re-reading it per note would be a request per note.
  const owned = ownedAssetFolderPaths(workspaceBodies(await container.workspace.snapshot()));
  let created = 0;
  let updated = 0;

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

/** Every body the workspace holds that can carry an image reference. */
function workspaceBodies(snapshot: WorkspaceSnapshot): string[] {
  return [
    ...snapshot.vaultPages.map((page) => page.body),
    ...snapshot.papers.map((paper) => paper.summary ?? ""),
  ];
}
