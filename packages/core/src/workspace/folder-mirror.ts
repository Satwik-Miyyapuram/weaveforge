/**
 * Keeping the folder in step with the database.
 *
 * The mirror is one-way and best-effort by design. Supabase is the source of
 * truth; the folder is a projection of it. That means a mirror failure — quota
 * exhausted, permission revoked, disk unplugged — must never fail the save that
 * triggered it. Losing a mirror write costs a stale file until the next sync;
 * failing the save would cost the user their edit.
 */

import { digestText } from "./change-origin.js";
import type { IWorkspaceFs } from "./fs-port.js";
import type { WorkspaceSnapshot } from "./workspace-snapshot.js";
import type { WorkspaceProject } from "./folder-layout.js";
import { vaultPageBase, type VaultPageBase } from "./merge-vault-page.js";
import { serializeWorkspace } from "./serialize-workspace.js";

export interface MirrorResult {
  written: string[];
  removed: string[];
  /** Unchanged files, skipped without a write. */
  unchanged: number;
  /**
   * A digest of every markdown file the folder now holds, by path.
   *
   * This is what the two sides agreed on at the end of this run, and the next
   * import compares against it to tell a folder edit from a workspace one.
   * Written and unchanged files alike: an unchanged file is still agreed.
   */
  mirrored: Record<string, string>;
  /**
   * Paths left as the folder has them, because they changed since the mirror
   * wrote them.
   *
   * A file the reader edited is not the mirror's to overwrite: writing would
   * lose the edit before the import could offer to apply it, and the folder is
   * the only copy of it. The caller surfaces these as outside changes, which is
   * what they are.
   */
  heldBack: string[];
  /**
   * The frontmatter and body digest of every note the folder now holds.
   *
   * Enough for the next import to merge per field rather than only report that
   * two copies differ. Notes only: the other entity types are written from
   * structured records the app owns, and a person editing one by hand in the
   * folder is not the case this was built for.
   */
  bases: Record<string, VaultPageBase>;
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
    /**
     * The project this snapshot belongs to. Every path is written inside its
     * folder, so a run for one project cannot mistake another project's files
     * for its own departed ones.
     */
    project: WorkspaceProject;
    /** Paths written by the previous run, so departures can be detected. */
    previousPaths?: readonly string[];
    /**
     * The digest of each path the last run wrote, from the project's manifest.
     *
     * This is what tells an edit from a difference. Without it the mirror can
     * only see that the file on disk is not what it would write, and it writes
     * — which is how a change made in the folder was lost before the import
     * could offer it. With it, a file whose content has moved on since the app
     * wrote it is somebody's, and is left alone.
     */
    base?: Readonly<Record<string, string>>;
    /** Fetch a blob for an asset the folder references. */
    fetchAsset?(storagePath: string): Promise<Uint8Array | null>;
  },
): Promise<MirrorResult> {
  const { files, assets } = serializeWorkspace(snapshot, options.project);
  const written: string[] = [];
  const removed: string[] = [];
  const heldBack: string[] = [];
  const held = new Set<string>();
  const mirrored: Record<string, string> = {};
  const bases: Record<string, VaultPageBase> = {};
  let unchanged = 0;

  /** The file on disk, when it is a reader's edit rather than the app's content. */
  const editedSinceBase = async (path: string, content: string): Promise<boolean> => {
    const recorded = options.base?.[path];
    if (recorded === undefined) return false;
    const onDisk = await fs.readText(path).catch(() => null);
    if (onDisk === null || onDisk === content) return false;
    return digestText(onDisk) !== recorded;
  };

  const hold = (path: string) => {
    if (held.has(path)) return;
    held.add(path);
    heldBack.push(path);
  };

  for (const [path, content] of Object.entries(files)) {
    mirrored[path] = digestText(content);
    const noteBase = vaultPageBase(path, content);
    if (noteBase) bases[path] = noteBase;
    const existing = await fs.stat(path).catch(() => null);
    if (existing) {
      const current = await fs.readText(path).catch(() => null);
      if (current === content) {
        unchanged += 1;
        continue;
      }
      // The folder's copy differs from what the app would write. If the app
      // wrote this path before and the file has moved on since, that difference
      // is the reader's edit: leave it, and say so.
      if (await editedSinceBase(path, content)) {
        hold(path);
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
    // An entity the workspace no longer has, but whose file the reader has since
    // edited: the file is theirs now, and deleting it would be the mirror doing
    // to a deletion what it must not do to a write.
    if (await editedSinceBase(path, "")) {
      hold(path);
      continue;
    }
    await fs.remove(path).catch(() => undefined);
    removed.push(path);
  }

  return { written, removed, unchanged, heldBack, mirrored, bases };
}
