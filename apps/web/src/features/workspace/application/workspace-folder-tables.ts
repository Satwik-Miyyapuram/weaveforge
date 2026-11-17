// Folder import and table restore pieces of workspace-folder.ts, split out to keep that file under the 800-line cap.

import type { getDataClient } from "@/lib/parts";
import type { applyFolderImport } from "./parts-1";
import {
  restoreSyncTables,
  syncKeyColumns,
  type SyncRow,
  type SyncTable,
  type RestoreConflict,
  type SyncTableReader,
  type SyncTableStore,
} from "./sync-tables";

/** PostgREST returns at most this many rows per request by default, so a table is read in pages. */
const REST_PAGE = 1000;

type DataClient = ReturnType<typeof getDataClient>;

/**
 * Every row of one table, one GET per page. Each page is ordered by the primary key:
 * without an order, Postgres may return a row on two pages or on none.
 */
async function pagedRows(client: DataClient, table: SyncTable, columns: string): Promise<SyncRow[]> {
  const rows: SyncRow[] = [];
  for (let from = 0; ; from += REST_PAGE) {
    let query = client.from(table).select(columns);
    for (const column of syncKeyColumns(table)) query = query.order(column);
    const { data, error } = await query.range(from, from + REST_PAGE - 1);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    const page = (data ?? []) as unknown as SyncRow[];
    rows.push(...page);
    if (page.length < REST_PAGE) return rows;
  }
}

/** Every row of one synced table, through the app's data client. */
export function restTableReader(client: DataClient): SyncTableReader {
  return (table) => pagedRows(client, table, "*");
}

/**
 * Fresh-clone order: restore the synced tables into the empty database first, then
 * diff the folder against what is now stored and apply that. Rows the tables already
 * wrote are "unchanged" in the diff, and the JSON files for relations, tags and reading
 * list items are dropped, so none of them is written a second time.
 *
 * Limit for 0.9.2: this is the clone path only. The restore refuses a database that
 * already holds rows the folder does not have; a re-pull into an existing workspace keeps
 * the incremental folder import (previewFolderImport + applyFolderImport) and does not call this.
 */
export async function restoreThenImport<T>(input: {
  store: SyncTableStore;
  tables: Partial<Record<SyncTable, SyncRow[]>>;
  preview: () => Promise<Parameters<typeof applyFolderImport>[0]>;
  apply: (diff: Parameters<typeof applyFolderImport>[0]) => Promise<T>;
  onRestoreConflicts?: (conflicts: RestoreConflict[]) => void;
}): Promise<T> {
  const conflicts = await restoreSyncTables(input.tables, input.store);
  if (conflicts.length > 0) input.onRestoreConflicts?.(conflicts);
  const diff = await input.preview();
  return input.apply({ ...diff, json: undefined });
}

export type FolderImportDiff = Parameters<typeof applyFolderImport>[0];
export type FolderImportPicks = Parameters<typeof applyFolderImport>[1];
export type FolderImportResult = Awaited<ReturnType<typeof applyFolderImport>> & {
  /** Stored rows the restore kept because they differ from the folder. Absent when there are none. */
  restoreConflicts?: RestoreConflict[];
};

/** How many conflicting rows a warning names before it counts the rest. */
const NAMED_CONFLICTS = 20;

/**
 * A conflict list as one line for a log: the first 20 rows by table and key, then the count
 * of any left out.
 */
export function describeRestoreConflicts(conflicts: RestoreConflict[]): string {
  const named = conflicts.slice(0, NAMED_CONFLICTS).map((c) => `${c.table} ${JSON.stringify(c.key)}`);
  const more = conflicts.length - named.length;
  if (more > 0) named.push(`and ${more} more`);
  return named.join("; ");
}

/**
 * A restore in progress. Set before the first insert, naming the project being restored,
 * and cleared once the import is applied. A restore that failed halfway resumes on the next
 * Apply in that same project, even though the database already holds some of its rows.
 */
export interface RestoreMarker {
  /** The project id the pending restore belongs to, or null when none is pending. */
  pendingFor(): Promise<string | null>;
  set(projectId: string): Promise<void>;
  clear(): Promise<void>;
}

/** What the Apply button reads and writes. Each one is a seam so the branch is tested without a folder or a server. */
export interface ImportSeams {
  store: SyncTableStore;
  folderTables: () => Promise<Partial<Record<SyncTable, SyncRow[]>> | null>;
  /** The active project's id. The restore marker is only resumed in the project it was set for. */
  activeProjectId: () => Promise<string>;
  preview: () => Promise<FolderImportDiff>;
  apply: (diff: FolderImportDiff, picks: FolderImportPicks) => Promise<FolderImportResult>;
  restoreMarker?: RestoreMarker;
  /** Named when a restore keeps stored rows that differ from the folder. */
  onRestoreConflicts?: (conflicts: RestoreConflict[]) => void;
  /** Named when a pending restore belongs to another project, so the restore is skipped. */
  onRestoreSkipped?: (message: string) => void;
}

/**
 * Restore target through the app's data client. A table is empty when one read returns
 * no row; the rows read pages through every stored row; each chunk is one plain POST.
 */
export function restTableStore(client: DataClient): SyncTableStore {
  return {
    async isEmpty(table: SyncTable) {
      const { data, error } = await client.from(table).select("*").range(0, 0);
      if (error) throw new Error(`Could not check ${table} before restore: ${error.message}`);
      return (data ?? []).length === 0;
    },
    rows(table: SyncTable, columns: readonly string[]) {
      return pagedRows(client, table, columns.join(","));
    },
    async insert(table: SyncTable, rows: SyncRow[]) {
      const { error } = await client.from(table).insert(rows);
      if (error) throw new Error(`Could not restore ${table}: ${error.message}`);
    },
  };
}
