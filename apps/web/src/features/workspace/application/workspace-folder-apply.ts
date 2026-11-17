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
} from "./workspace-folder-tables";

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
  const empty = (await Promise.all(SYNC_TABLES.map((t) => seams.store.isEmpty(t)))).every(Boolean);
  if (tables && empty) {
    return restoreThenImport({
      store: seams.store,
      tables,
      preview: seams.preview,
      apply: (fresh) => seams.apply(fresh, picks),
    });
  }
  return seams.apply(diff, picks);
}
