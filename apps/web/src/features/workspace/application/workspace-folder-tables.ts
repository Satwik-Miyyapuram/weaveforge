// Folder import and table restore pieces of workspace-folder.ts, split out to keep that file under the 800-line cap.

import type { getDataClient } from "@/lib/parts";
import type { applyFolderImport } from "./parts-1";
import { restoreSyncTables, type SyncRow, type SyncTable, type SyncTableReader, type SyncTableStore } from "./sync-tables";

/** PostgREST returns at most this many rows per request by default, so a table is read in pages. */
const REST_PAGE = 1000;

/**
 * Every row of one synced table, through the app's data client. One GET per page;
 * a table of up to one page is one request.
 */
export function restTableReader(client: ReturnType<typeof getDataClient>): SyncTableReader {
  return async (table) => {
    const rows: SyncRow[] = [];
    for (let from = 0; ; from += REST_PAGE) {
      const { data, error } = await client
        .from(table)
        .select("*")
        .range(from, from + REST_PAGE - 1);
      if (error) throw new Error(`Could not read ${table} for the folder: ${error.message}`);
      const page = (data ?? []) as SyncRow[];
      rows.push(...page);
      if (page.length < REST_PAGE) return rows;
    }
  };
}

/**
 * Fresh-clone order: restore the synced tables into the empty database first, then
 * diff the folder against what is now stored and apply that. Rows the tables already
 * wrote are "unchanged" in the diff, and the JSON files for relations, tags and reading
 * list items are dropped, so none of them is written a second time.
 *
 * Limit for 0.9.2: this is the clone path only. The restore refuses a database that
 * already holds synced rows; a re-pull into an existing workspace keeps the incremental
 * folder import (previewFolderImport + applyFolderImport) and does not call this.
 */
export async function restoreThenImport<T>(input: {
  store: SyncTableStore;
  tables: Partial<Record<SyncTable, SyncRow[]>>;
  preview: () => Promise<Parameters<typeof applyFolderImport>[0]>;
  apply: (diff: Parameters<typeof applyFolderImport>[0]) => Promise<T>;
}): Promise<T> {
  await restoreSyncTables(input.tables, input.store);
  const diff = await input.preview();
  return input.apply({ ...diff, json: undefined });
}

export type FolderImportDiff = Parameters<typeof applyFolderImport>[0];
export type FolderImportPicks = Parameters<typeof applyFolderImport>[1];
export type FolderImportResult = Awaited<ReturnType<typeof applyFolderImport>>;

/** What the Apply button reads and writes. Each one is a seam so the branch is tested without a folder or a server. */
export interface ImportSeams {
  store: SyncTableStore;
  folderTables: () => Promise<Partial<Record<SyncTable, SyncRow[]>> | null>;
  preview: () => Promise<FolderImportDiff>;
  apply: (diff: FolderImportDiff, picks: FolderImportPicks) => Promise<FolderImportResult>;
}
/**
 * Restore target through the app's data client: a table is empty when one read
 * returns no row, and each chunk is one plain POST with explicit values.
 */
export function restTableStore(client: ReturnType<typeof getDataClient>): SyncTableStore {
  return {
    async isEmpty(table: SyncTable) {
      const { data, error } = await client.from(table).select("*").range(0, 0);
      if (error) throw new Error(`Could not check ${table} before restore: ${error.message}`);
      return (data ?? []).length === 0;
    },
    async insert(table: SyncTable, rows: SyncRow[]) {
      const { error } = await client.from(table).insert(rows);
      if (error) throw new Error(`Could not restore ${table}: ${error.message}`);
    },
  };
}