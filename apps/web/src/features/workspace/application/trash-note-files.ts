import type { IWorkspaceFs } from "@weaveforge/core";

import { desktop } from "@/lib/desktop/desktop-bridge";
import { loadCore, readyCore } from "@/lib/rust-core";
import { moveToTrash } from "@/lib/workspace-trash";

import { folderLock } from "./folder-lock";
import { activeProject } from "./parts";
import { inkFolderShared } from "./parts-1";
import { readMirrorBase, readMirrorBases, writeMirrorManifest } from "./parts-3";
import { activeWorkspaceFs, folderSession } from "./workspace-folder";

/** Moves one file or folder to `.weaveforge/trash`. */
export type Trash = (path: string) => Promise<void>;

/**
 * The browser's trash: each file through `moveToTrash`, subfolders the same
 * way, then the emptied folder, which is only removed when nothing new landed in it.
 */
export function folderTrash(fs: IWorkspaceFs, now: number): Trash {
  const trash: Trash = async (path) => {
    const stat = await fs.stat(path);
    if (stat?.kind !== "dir") return moveToTrash(fs, path, now);
    for (const entry of await fs.list(path)) await trash(entry.path);
    await fs.remove(path).catch(() => undefined);
  };
  return trash;
}

/**
 * A deleted note leaves the folder: its `.md` and its ink folder go to the
 * trash (unless another note still shares that folder), then the manifest forgets the path. Without that last step the base
 * would outlive the file, and a file of the same name made later would be
 * compared against a note that no longer exists.
 *
 * A failed move throws before the manifest is touched: the file and its base
 * both stay, and the import reads that as "deleted in the app".
 */
export async function trashNoteFiles(
  fs: IWorkspaceFs,
  projectRoot: string,
  notePath: string,
  trash: Trash,
): Promise<void> {
  if (await fs.stat(notePath)) await trash(notePath);
  const ink = readyCore().inkStrokesDir(notePath);
  if ((await fs.stat(ink)) && !(await inkFolderShared(fs, notePath))) await trash(ink);
  const base = await readMirrorBase(fs, projectRoot);
  if (!(notePath in base)) return;
  const bases = await readMirrorBases(fs, projectRoot);
  delete base[notePath];
  delete bases[notePath];
  await writeMirrorManifest(fs, projectRoot, Object.keys(base), base, bases);
}

/**
 * {@link trashNoteFiles} in the open folder, under the folder lock. The desktop
 * shell moves the file itself (`file_delete`, `Vault::delete_to_trash`), so its
 * watcher knows the removal was the app's; the browser renames it there.
 */
export function trashDeletedNote(notePath: string): Promise<void> {
  return folderLock.run(async () => {
    const fs = activeWorkspaceFs();
    if (!fs) return;
    const root = (await loadCore()).projectDir(await activeProject());
    const shell = folderSession()?.kind === "desktop" ? desktop() : null;
    const trash: Trash = shell?.trashVaultFile
      ? (path) => shell.trashVaultFile!(path)
      : folderTrash(fs, Date.now());
    await trashNoteFiles(fs, root, notePath, trash);
  });
}
