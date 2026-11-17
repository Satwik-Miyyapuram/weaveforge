/**
 * Applying a reviewed folder import.
 *
 * An empty workspace with table files in the folder restores the tables first
 * (clone order); anything else is the plain apply of the diff the user reviewed.
 */
import type { IWorkspaceFs } from "@weaveforge/core";
import { loadCore } from "@/lib/rust-core";
import { activeProject } from "./parts";
import {
  RestoreRefusedError,
  SYNC_TABLES,
  syncTableFile,
  syncTableRowsFromFolder,
  type RestoreConflict,
  type SyncRow,
  type SyncTable,
} from "./sync-tables";
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
 * The restore marker at the workspace root. It records the project the restore belongs to,
 * because the folder's table files are per project: a restore that stopped partway resumes
 * only when that project is open. The folder is looked up on each call, so the seam can be
 * built before a folder is connected; with no folder, nothing is pending and nothing can be set.
 * A marker that cannot be read is treated as no pending restore.
 */
export function folderRestoreMarker(fs: () => IWorkspaceFs | null): RestoreMarker {
  const markerPath = async (): Promise<{ file: IWorkspaceFs; path: string } | null> => {
    const file = fs();
    if (!file) return null;
    return { file, path: RESTORE_MARKER };
  };
  return {
    async pendingFor() {
      const marker = await markerPath();
      if (!marker) return null;
      const text = await marker.file.readText(marker.path).catch(() => null);
      if (text === null) return null;
      try {
        const projectId = (JSON.parse(text) as { projectId?: unknown }).projectId;
        return typeof projectId === "string" ? projectId : null;
      } catch {
        return null;
      }
    },
    async set(projectId: string) {
      const marker = await markerPath();
      if (!marker) throw new Error("No folder is connected.");
      await marker.file.writeFile(marker.path, `${JSON.stringify({ projectId })}\n`);
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
  const projectId = await seams.activeProjectId();
  const pendingFor = (await seams.restoreMarker?.pendingFor()) ?? null;
  if (pendingFor !== null && pendingFor !== projectId) {
    // The unfinished restore is another project's. Its folder tables are not this project's, so it stays pending.
    seams.onRestoreSkipped?.(
      `A table restore for project ${pendingFor} stopped partway and is not finished. It resumes when that project is open. This project's tables were not restored.`,
    );
    return seams.apply(diff, picks);
  }
  // A pending marker for this project means an earlier restore stopped partway: resume it even though the database has rows.
  const empty = pendingFor === projectId || (await Promise.all(SYNC_TABLES.map((t) => seams.store.isEmpty(t)))).every(Boolean);
  if (tables && empty) {
    await seams.restoreMarker?.set(projectId);
    let conflicts: RestoreConflict[] = [];
    try {
      const result = await restoreThenImport({
        store: seams.store,
        tables,
        preview: seams.preview,
        apply: (fresh) => seams.apply(fresh, picks),
        onRestoreConflicts: (found) => {
          conflicts = found;
          seams.onRestoreConflicts?.(found);
        },
      });
      await seams.restoreMarker?.clear();
      return conflicts.length > 0 ? { ...result, restoreConflicts: conflicts } : result;
    } catch (error) {
      // The database refused this restore; retrying it cannot succeed, so the marker goes and Apply stops resuming it.
      if (error instanceof RestoreRefusedError) await seams.restoreMarker?.clear();
      throw error;
    }
  }
  return seams.apply(diff, picks);
}
