import {
  ASSET_DIR,
  fromRelativeBlobLinks,
  projectDir,
  type ImportDiff,
  type ImportDiffEntry,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { activeProject } from "./active-project";
import {
  assetExtension,
  assetMimeType,
  ownedAssetFolderPaths,
  planAssetReanchor,
  workspaceBodies,
} from "./asset-reanchor";
import { refreshMirrorBase, applyJsonEntries } from "./folder-json-import";
import { claimImportedFile } from "./mirror-manifest";
import { writeConflictMarkersTo, type ConflictResolution, settleConflict } from "./folder-merge";
import { activeWorkspaceFs, syncToFolder } from "./workspace-folder";

export type { ConflictResolution };

let pendingAssets = new Map<string, Uint8Array>();

export function setPendingAssets(assets: Map<string, Uint8Array>): void {
  pendingAssets = assets;
}

export function clearPendingAssets(): void {
  pendingAssets = new Map();
}

/**
 * Apply what the user chose from the preview: create and update notes.
 *
 * Conflicted files have already been resolved (in memory) to one of the two
 * copies, or to a compose made of hunk-level picks.
 */
export async function applyFolderImport(
  diff: ImportDiff,
  resolutions: Readonly<Record<string, ConflictResolution>> = {},
): Promise<{ created: number; updated: number }> {
  const fs = activeWorkspaceFs();
  if (!fs) return { created: 0, updated: 0 };

  const result = await applyEntries(fs, diff, resolutions);
  const appliedJson = (diff as { json?: import("@weaveforge/core").JsonDiff }).json
    ? await applyJsonEntries((diff as { json?: import("@weaveforge/core").JsonDiff }).json!)
    : [];
  // What was applied, the two sides now agree on: the folder's text becomes
  // the base, or the mirror would keep holding those files back for an edit
  // that has already landed. Settled conflicts are included here.
  await refreshMirrorBase(fs, [
    ...result.appliedPaths,
    ...appliedJson,
  ]);

  await syncToFolder().catch(() => undefined);
  return { created: result.created, updated: result.updated };
}

/** See `writeConflictMarkersTo`: this window's folder gets the markers. */
export function writeMarkersFor(entry: ImportDiffEntry): Promise<boolean> {
  const fs = activeWorkspaceFs();
  return fs ? writeConflictMarkersTo(fs, entry) : Promise.resolve(false);
}

async function applyEntries(
  fs: import("@weaveforge/core").IWorkspaceFs,
  diff: ImportDiff,
  resolutions: Readonly<Record<string, ConflictResolution>>,
): Promise<{ created: number; updated: number; appliedPaths: string[] }> {
  const container = getContainer();
  const owned = ownedAssetFolderPaths(workspaceBodies(await container.workspace.snapshot()));
  const projectRoot = projectDir(await activeProject());
  let created = 0;
  let updated = 0;
  const appliedPaths: string[] = [];

  for (const raw of diff.entries) {
    const entry = raw.action === "conflict" ? settleConflict(raw, resolutions) : raw;
    if (!entry) continue;

    if (entry.action === "conflict" || entry.action === "unchanged" || entry.action === "removed") {
      continue;
    }

    if (entry.action === "created") {
      const page = await container.vault.manageVaultPage.add({
        title: entry.entity.title,
        body: await reanchorAssets(entry.entity.body, "new", owned),
      });
      if (entry.entity.path) {
        await claimImportedFile(fs, entry.entity.path, page.id, projectRoot).catch(
          () => false,
        );
      }
      created += 1;
      appliedPaths.push(entry.entity.path);
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
    appliedPaths.push(entry.entity.path);
  }

  pendingAssets = new Map();
  return { created, updated, appliedPaths };
}

/**
 * Turn an imported body's relative image links back into storage references.
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
