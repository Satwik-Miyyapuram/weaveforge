import {
  ASSET_DIR,
  fromRelativeBlobLinks,
  type ImportDiff,
  type ImportDiffEntry,
  type IWorkspaceFs,
  type JsonDiff,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { loadCore } from "@/lib/rust-core";
import { activeProject } from "./active-project";
import {
  assetExtension,
  assetMimeType,
  ownedAssetFolderPaths,
  planAssetReanchor,
  workspaceBodies,
} from "./asset-reanchor";
import { refreshMirrorBase, applyJsonEntries } from "./folder-json-import";
import { baseDigest, claimImportedFile } from "./mirror-manifest";
import { writeConflictMarkersTo, type ConflictResolution, settleConflict } from "./folder-merge";
import { activeWorkspaceFs, syncToFolder } from "./workspace-folder";

export type { ConflictResolution };

let pendingAssets = new Map<string, Uint8Array>();

/**
 * Notes made from a hand-written file whose id could not be written back into
 * it, by path. That file still has no id, so the next preview offers it as new
 * again; this lets the next apply update the note it made instead of adding a
 * second one.
 */
const unclaimed = new Map<string, string>();

export function setPendingAssets(assets: Map<string, Uint8Array>): void {
  pendingAssets = assets;
}

export function clearPendingAssets(): void {
  pendingAssets = new Map();
}

/** For a run started in the background against one folder. */
export interface ApplyOptions {
  /** The folder the diff was read from; the apply refuses if another is connected now. */
  fs?: IWorkspaceFs;
  /** Digest per path when previewed; a file that moved since keeps its old base. */
  expected?: Readonly<Record<string, string>>;
  /**
   * Each note's `storedDigest` when previewed, by id. A note written in the app
   * since (server sync, an agent, a late editor flush) is not overwritten; its
   * path comes back in `moved`.
   */
  stored?: Readonly<Record<string, string>>;
  /** Paths that are renames (`renamedPaths`): retitled from the new name, then left to the mirror to write. */
  renamed?: ReadonlySet<string>;
}

/** A note's title and body as one digest: what an update would overwrite. */
export function storedDigest(page: { title: string; body: string }): string {
  return baseDigest(`${page.title}
${page.body}`);
}

/**
 * Apply what the user chose from the preview: create and update notes.
 *
 * Conflicted files have already been resolved (in memory) to one of the two
 * copies, or to a compose made of hunk-level picks. Throws when no folder is
 * connected, so the import screen says so rather than reporting nothing done.
 */
export async function applyFolderImport(
  diff: ImportDiff & { json?: JsonDiff },
  resolutions: Readonly<Record<string, ConflictResolution>> = {},
  options: ApplyOptions = {},
): Promise<{ created: number; updated: number; moved: string[] }> {
  const fs = activeWorkspaceFs();
  if (!fs) throw new Error("No workspace folder is connected. Connect one in Settings, then import again.");
  if (options.fs && options.fs !== fs) throw new Error("The folder changed before its edits were taken in.");

  const result = await applyEntries(fs, diff, resolutions, options.stored, options.renamed);
  const appliedJson = await applyJsonEntries(diff.json);
  // What was applied, the two sides now agree on: the folder's text becomes
  // the base, or the mirror would keep holding those files back for an edit
  // that has already landed. Settled conflicts are included here.
  await refreshMirrorBase(fs, [
    ...result.appliedPaths,
    ...appliedJson,
  ], options.expected ?? {});

  await syncToFolder().catch(() => undefined);
  return { created: result.created, updated: result.updated, moved: result.moved };
}

/**
 * Answer a held outside edit with the workspace's copy: write it over the folder's file and make that
 * the base, so the edit no longer waits. False when the workspace writes nothing at that path.
 */
export async function keepWorkspaceCopy(fs: IWorkspaceFs, path: string): Promise<boolean> {
  const core = await loadCore();
  const snapshot = await getContainer().workspace.snapshot();
  const text = core.serializeWorkspace(snapshot, await activeProject()).files[path];
  if (text === undefined) return false;
  await fs.writeFile(path, text);
  await refreshMirrorBase(fs, [path]);
  return true;
}

/** See `writeConflictMarkersTo`: this window's folder gets the markers. */
export async function writeMarkersFor(entry: ImportDiffEntry): Promise<boolean> {
  const fs = activeWorkspaceFs();
  if (!fs) return false;
  return writeConflictMarkersTo(await loadCore(), fs, entry);
}

/** @internal exported for tests */
export async function applyEntries(
  fs: IWorkspaceFs,
  diff: ImportDiff,
  resolutions: Readonly<Record<string, ConflictResolution>>,
  stored?: Readonly<Record<string, string>>,
  renamed: ReadonlySet<string> = new Set(),
): Promise<{ created: number; updated: number; appliedPaths: string[]; moved: string[] }> {
  const core = await loadCore();
  const container = getContainer();
  const owned = ownedAssetFolderPaths(workspaceBodies(await container.workspace.snapshot()));
  const projectRoot = core.projectDir(await activeProject());
  let created = 0;
  let updated = 0;
  const appliedPaths: string[] = [];
  const moved: string[] = [];

  for (const raw of diff.entries) {
    const entry = raw.action === "conflict" ? settleConflict(core, raw, resolutions) : raw;
    if (!entry) continue;

    if (entry.action === "conflict" || entry.action === "unchanged" || entry.action === "removed") {
      continue;
    }

    if (entry.action === "created") {
      const path = entry.entity.path;
      const earlier = path ? unclaimed.get(path) : undefined;
      const made = earlier ? await container.vault.getPage(earlier) : null;
      let id: string;
      if (made) {
        await container.vault.manageVaultPage.update(made.id, {
          title: entry.entity.title,
          body: await reanchorAssets(entry.entity.body, made.id, owned),
        });
        id = made.id;
        updated += 1;
      } else {
        const page = await container.vault.manageVaultPage.add({
          title: entry.entity.title,
          body: await reanchorAssets(entry.entity.body, "new", owned),
        });
        id = page.id;
        created += 1;
      }
      if (path) {
        try {
          await claimImportedFile(fs, path, id, projectRoot);
          unclaimed.delete(path);
        } catch {
          unclaimed.set(path, id);
        }
      }
      appliedPaths.push(path);
      continue;
    }

    if (!entry.entity.id) continue;
    const page = await container.vault.getPage(entry.entity.id);
    if (!page) continue;
    const seen = stored?.[page.id];
    if (seen !== undefined && storedDigest(page) !== seen) {
      moved.push(entry.entity.path);
      continue;
    }
    const path = entry.entity.path;
    const rename = renamed.has(path);
    // A renamed file still carries the old title in its frontmatter; the new name says what it is now.
    const title = rename && entry.entity.title === page.title ? titleFromFileName(path) : entry.entity.title;
    await container.vault.manageVaultPage.update(page.id, {
      title,
      body: await reanchorAssets(entry.entity.body, page.id, owned),
    });
    updated += 1;
    if (!rename) {
      appliedPaths.push(path);
      continue;
    }
    // The note is whole in the workspace now; the mirror writes it at the path its title gives.
    await fs.remove(path).catch(() => undefined);
  }

  pendingAssets = new Map();
  return { created, updated, appliedPaths, moved };
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

/** The title a renamed file's name gives: no folder, kind suffix or id suffix. */
export function titleFromFileName(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "").replace(/\.(note|ink)$/, "");
  return name.replace(/--[A-Za-z0-9]{1,8}$/, "").trim() || "Untitled";
}
