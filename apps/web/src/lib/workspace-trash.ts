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
 * Renames `path` to the first free trash name for `now` (`-2`, `-3`, … on a
 * clash). The name is claimed by an exclusive create first, so a file that
 * appears there between a look and the rename is never overwritten. Without a
 * conditional write the name cannot be claimed safely, so it refuses. If the
 * rename fails and the claim is still empty, it is removed again and the error
 * is rethrown; if the file left and its text reached the trash (moved, then an
 * error), the trashed copy is kept and the move counts as done.
 */
export async function moveToTrash(fs: IWorkspaceFs, path: string, now: number): Promise<void> {
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
      // An empty target is only our own claim: give it back. A failed clean-up keeps the rename's error.
      if (trashed === "") {
        await fs.remove(target).catch(() => {});
        throw error;
      }
      // The file left its place and its text is in the trash (moved, then a failure was reported). Keep it.
      if (trashed !== null && (await fs.stat(path).catch(() => "unknown" as const)) === null) return;
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
  fs: IWorkspaceFs,
  folder: string,
  now: number,
): Promise<{ target: string; release: () => Promise<void> }> {
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
    return { target, release: () => fs.remove(marker).catch(() => {}) };
  }
  throw new ConflictError(`${folder}: no free name in the trash; not removed.`);
}