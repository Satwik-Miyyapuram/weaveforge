import {
  ASSET_DIR,
  NoOpWorkspaceGit,
  describeChanges,
  diffWorkspace,
  fromRelativeBlobLinks,
  mirrorWorkspace,
  parseWorkspaceFolder,
  type ImportDiff,
  type IWorkspaceFs,
  type IWorkspaceGit,
  type MirrorResult,
  type WorkspaceCommit,
  type WorkspaceSnapshot,
} from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { BrowserWorkspaceFs } from "../infrastructure/browser-workspace-fs";
import { IsomorphicWorkspaceGit } from "../infrastructure/isomorphic-workspace-git";
import {
  assetExtension,
  assetMimeType,
  ownedAssetFolderPaths,
  planAssetReanchor,
} from "./asset-reanchor";
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
let lastWrittenPaths: string[] = [];

/**
 * Asset bytes from the most recent preview, keyed by folder path.
 *
 * Held between preview and apply because the preview must not upload anything —
 * looking at a diff is not consent to write — and by apply time the archive is
 * long gone. Cleared when the import is applied or the folder is closed.
 */
let pendingAssets = new Map<string, Uint8Array>();

export interface FolderSession {
  kind: "picked" | "opfs";
  git: "none" | "isomorphic";
}

export function folderSession(): FolderSession | null {
  if (!activeFs) return null;
  return {
    kind: activeFs instanceof BrowserWorkspaceFs ? "picked" : "opfs",
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
  lastWrittenPaths = [];
  return true;
}

/** Fall back to origin-private storage where the picker is unavailable. */
export async function openBrowserStorageFolder(options: { git: boolean }): Promise<void> {
  const fs = await BrowserWorkspaceFs.openOpfs();
  activeFs = fs;
  activeGit = options.git ? new IsomorphicWorkspaceGit(fs) : new NoOpWorkspaceGit();
  lastWrittenPaths = [];
}

export function closeFolder(): void {
  activeFs = null;
  activeGit = new NoOpWorkspaceGit();
  lastWrittenPaths = [];
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
  const container = getContainer();
  const snapshot = await container.workspace.snapshot();

  const mirror = await mirrorWorkspace(snapshot, activeFs, {
    previousPaths: lastWrittenPaths,
    fetchAsset: async (storagePath) => {
      const blobs = await container.vault.fetchAssetBlobs([storagePath]);
      const blob = blobs.get(storagePath);
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    },
  });
  lastWrittenPaths = [...mirror.written, ...lastWrittenPaths.filter((p) => !mirror.removed.includes(p))];

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

  return diffAgainstWorkspace(files, assets);
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

  return diffWorkspace(parsed, existing);
}

/**
 * Apply an import.
 *
 * Only notes are written. Papers, experiments, and the rest carry structured
 * fields that a markdown body cannot round-trip faithfully, and half-importing
 * a paper — body updated, metadata silently stale — is worse than not
 * importing it. Conflicts are never applied.
 */
export async function applyFolderImport(diff: ImportDiff): Promise<{ created: number; updated: number }> {
  const container = getContainer();
  // Read once: the set only has to describe the workspace as it stood before
  // the import, and re-reading it per note would be a request per note.
  const owned = ownedAssetFolderPaths(workspaceBodies(await container.workspace.snapshot()));
  let created = 0;
  let updated = 0;

  for (const entry of diff.entries) {
    if (entry.entity.type !== "vault_page") continue;
    if (entry.action === "conflict" || entry.action === "unchanged") continue;

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
