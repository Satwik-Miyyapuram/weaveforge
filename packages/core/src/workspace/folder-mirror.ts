/**
 * Keeping the folder in step with the database.
 *
 * The mirror is one-way and best-effort by design. Supabase is the source of
 * truth; the folder is a projection of it. That means a mirror failure — quota
 * exhausted, permission revoked, disk unplugged — must never fail the save that
 * triggered it. Losing a mirror write costs a stale file until the next sync;
 * failing the save would cost the user their edit.
 */

import type { IWorkspaceFs } from "./fs-port.js";
import type { WorkspaceSnapshot } from "./workspace-snapshot.js";
import { serializeWorkspace } from "./serialize-workspace.js";

export type MirrorMode = "off" | "on";

export interface MirrorResult {
  written: string[];
  removed: string[];
  /** Unchanged files, skipped without a write. */
  unchanged: number;
}

/**
 * Write a snapshot to the folder, removing files that no longer belong.
 *
 * Content is compared before writing so an unchanged workspace produces no
 * filesystem churn — and, once git is on, no commits full of untouched files.
 * That is only possible because serialization is deterministic.
 *
 * Only files the serializer owns are removed. Anything else in the folder —
 * a user's own notes, a `.obsidian/` directory, an editor's scratch files — is
 * left alone. Deleting unrecognised files in a folder the user can see would
 * be an unpleasant surprise the first time it happened.
 */
export async function mirrorWorkspace(
  snapshot: WorkspaceSnapshot,
  fs: IWorkspaceFs,
  options: {
    /** Paths written by the previous run, so departures can be detected. */
    previousPaths?: readonly string[];
    /** Fetch a blob for an asset the folder references. */
    fetchAsset?(storagePath: string): Promise<Uint8Array | null>;
  } = {},
): Promise<MirrorResult> {
  const { files, assets } = serializeWorkspace(snapshot);
  const written: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;

  for (const [path, content] of Object.entries(files)) {
    const existing = await fs.stat(path).catch(() => null);
    if (existing) {
      const current = await fs.readText(path).catch(() => null);
      if (current === content) {
        unchanged += 1;
        continue;
      }
    }
    // Root-level files (README.md) have no directory to create, and "." is not
    // a valid workspace path.
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) await fs.mkdirp(dir);
    await fs.writeFile(path, content);
    written.push(path);
  }

  if (options.fetchAsset) {
    for (const asset of assets) {
      // Assets are immutable once written: the storage path contains a uuid, so
      // a differing path means a different file. Re-fetching an existing one
      // would be a download for no reason.
      if (await fs.stat(asset.folderPath).catch(() => null)) {
        unchanged += 1;
        continue;
      }
      const bytes = await options.fetchAsset(asset.storagePath);
      if (!bytes) continue;
      const assetDir = asset.folderPath.split("/").slice(0, -1).join("/");
      if (assetDir) await fs.mkdirp(assetDir);
      await fs.writeFile(asset.folderPath, bytes);
      written.push(asset.folderPath);
    }
  }

  const current = new Set([...Object.keys(files), ...assets.map((a) => a.folderPath)]);
  for (const path of options.previousPaths ?? []) {
    if (current.has(path)) continue;
    await fs.remove(path).catch(() => undefined);
    removed.push(path);
  }

  return { written, removed, unchanged };
}
