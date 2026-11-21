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
 * conditional write the name cannot be claimed safely, so it refuses.
 */
export async function moveToTrash(fs: IWorkspaceFs, path: string, now: number): Promise<void> {
  if (!fs.writeTextIf) throw new Error(`${path}: this workspace has no conditional write; not deleted.`);
  const core = typedCore();
  for (let n = 1; n <= NAME_ATTEMPTS; n += 1) {
    const target = core.trashPathFor(path, now, n);
    await fs.mkdirp(target.slice(0, target.lastIndexOf("/")));
    if (!(await fs.writeTextIf(target, "", null))) continue;
    await fs.rename(path, target);
    return;
  }
  throw new ConflictError(`${path}: no free name in the trash; not deleted.`);
}
