/**
 * Applying a reviewed folder import.
 *
 * An empty workspace with table files in the folder restores the tables first
 * (clone order); anything else is the plain apply of the diff the user reviewed.
 */
import type { IWorkspaceFs } from "@weaveforge/core";
import { loadCore } from "@/lib/rust-core";
import { activeProject } from "./parts";
import { SYNC_TABLES, syncTableFile, syncTableRowsFromFolder, type SyncRow, type SyncTable } from "./sync-tables";
import {
  restoreThenImport,
  type FolderImportDiff,
  type FolderImportPicks,
  type FolderImportResult,
  type ImportSeams,
  type RestoreMarker,
} from "./workspace-folder-tables";

/** Git-excluded (`/.weaveforge/`), so the marker never reaches the repo. */
const RESTORE_MARKER = ".weaveforge/restore-pending.json";

/**
 * The restore marker as a file in the active project's folder. The folder is looked up
 * on each call, so the seam can be built before a folder is connected; with no folder,
 * nothing is pending and nothing can be set.
 */
export function folderRestoreMarker(fs: () => IWorkspaceFs | null): RestoreMarker {
  const markerPath = async (): Promise<{ file: IWorkspaceFs; path: string } | null> => {
    const file = fs();
    if (!file) return null;
    const projectRoot = (await loadCore()).projectDir(await activeProject());
    return { file, path: `${projectRoot}/${RESTORE_MARKER}` };
  };
  return {
    async isPending() {
      const marker = await markerPath();
      if (!marker) return false;
      return (await marker.file.readText(marker.path).catch(() => null)) !== null;
    },
    async set() {
      const marker = await markerPath();
      if (!marker) throw new Error("No folder is connected.");
      await marker.file.writeFile(marker.path, "{}\n");
    },
    async clear() {
      const marker = await markerPath();
      if (marker) await marker.file.remove(marker.path).catch(() => undefined);
    },
  };
}

/** Table rows from the connected folder, or null when it has no table files. */
export async function connectedFolderTables(
  fs: IWorkspaceFs | null,
): Promise<Partial<Record<SyncTable, SyncRow[]>> | null> {
  if (!fs) return null;
  const projectRoot = (await loadCore()).projectDir(await activeProject());
  const folder: Record<string, string> = {};
  for (const table of SYNC_TABLES) {
    const text = await fs.readText(`${projectRoot}/${syncTableFile(table)}`).catch(() => null);
    if (text !== null) folder[syncTableFile(table)] = text;
  }
  return Object.keys(folder).length === 0 ? null : syncTableRowsFromFolder(folder);
}

export async function applyReviewedFolderImport(
  diff: FolderImportDiff,
  picks: FolderImportPicks,
  seams: ImportSeams,
): Promise<FolderImportResult> {
  const tables = await seams.folderTables();
  // A pending marker means an earlier restore stopped partway: resume it even though the database has rows.
  const pending = (await seams.restoreMarker?.isPending()) ?? false;
  const empty = pending || (await Promise.all(SYNC_TABLES.map((t) => seams.store.isEmpty(t)))).every(Boolean);
  if (tables && empty) {
    await seams.restoreMarker?.set();
    const result = await restoreThenImport({
      store: seams.store,
      tables,
      preview: seams.preview,
      apply: (fresh) => seams.apply(fresh, picks),
    });
    await seams.restoreMarker?.clear();
    return result;
  }
  return seams.apply(diff, picks);
}
