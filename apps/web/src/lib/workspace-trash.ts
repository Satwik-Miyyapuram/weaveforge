/**
 * Moving a workspace file to the trash instead of deleting it.
 *
 * Shared by the repositories that delete user files (papers, notes), so a
 * delete is always recoverable from `.weaveforge/trash`.
 */
import type { IWorkspaceFs } from "@weaveforge/core";
import { ConflictError } from "@weaveforge/core";
import { typedCore } from "@/lib/rust-core";

const NAME_ATTEMPTS = 1000;

/**
 * The folder `fs` points at now. An fs that follows the open folder (the no-account fs) offers
 * `pin`, so a folder switch mid-move cannot put the claim in one folder and the rename in another.
 */
function pinned(fs: IWorkspaceFs): IWorkspaceFs {
  return (fs as { pin?: () => IWorkspaceFs }).pin?.() ?? fs;
}

/**
 * Renames `path` to the first free trash name for `now` (`-2`, `-3`, … on a
 * clash). The name is claimed by an exclusive create first, so a file that
 * appears there between a look and the rename is never overwritten. Without a
 * conditional write the name cannot be claimed safely, so it refuses. If the
 * rename fails but the file left its place and the trash name is readable
 * (moved, then an error), the trashed copy is kept, even when empty, and the
 * move counts as done. Otherwise an empty claim is removed again and the error
 * is rethrown.
 */
export async function moveToTrash(open: IWorkspaceFs, path: string, now: number): Promise<void> {
  const fs = pinned(open);
  if (!fs.writeTextIf) throw new Error(`${path}: this workspace has no conditional write; not deleted.`);
  const core = typedCore();
  for (let n = 1; n <= NAME_ATTEMPTS; n += 1) {
    const target = core.trashPathFor(path, now, n);
    await fs.mkdirp(target.slice(0, target.lastIndexOf("/")));
    if (!(await fs.writeTextIf(target, "", null))) continue;
    try {
      await fs.rename(path, target);
    } catch (error) {
      const trashed = await fs.readText(target).catch(() => null);
      // The file left its place and the trash name holds text (moved, then a failure was reported).
      // Keep it even when empty: an empty user file that moved looks just like our claim.
      if (trashed !== null && (await fs.stat(path).catch(() => "unknown" as const)) === null) return;
      // The source is still there (or cannot be checked), so an empty target is only our claim: give
      // it back. A failed clean-up keeps the rename's error.
      if (trashed === "") await fs.remove(target).catch(() => {});
      throw error;
    }
    return;
  }
  throw new ConflictError(`${path}: no free name in the trash; not deleted.`);
}

/**
 * Claims the first free trash name for a whole folder: an exclusive `<name>.claim`
 * marker beside it, so two folder trashes never pick the same name, and a name
 * already in the trash is skipped. The caller moves the files under `target`,
 * then calls `release` to drop the marker.
 */
export async function claimTrashFolder(
  open: IWorkspaceFs,
  folder: string,
  now: number,
): Promise<{ target: string; release: () => Promise<void> }> {
  const fs = pinned(open);
  if (!fs.writeTextIf) throw new Error(`${folder}: this workspace has no conditional write; not removed.`);
  const core = typedCore();
  for (let n = 1; n <= NAME_ATTEMPTS; n += 1) {
    const target = core.trashPathFor(folder, now, n);
    const marker = `${target}.claim`;
    await fs.mkdirp(target.slice(0, target.lastIndexOf("/")));
    if (!(await fs.writeTextIf(marker, "", null))) continue;
    if (await fs.stat(target)) {
      await fs.remove(marker).catch(() => {});
      continue;
    }
    const release = () =>
      fs.remove(marker).catch((error: unknown) => {
        // A left-over marker only blocks this one trash name; log it so it can be cleaned up.
        console.warn(`Trash claim marker ${marker} could not be removed:`, error);
      });
    return { target, release };
  }
  throw new ConflictError(`${folder}: no free name in the trash; not removed.`);
}