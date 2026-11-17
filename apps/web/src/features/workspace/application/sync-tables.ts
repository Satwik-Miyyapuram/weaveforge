/**
 * Every row of every synced table, one JSON file per table under
 * `.weaveforge/tables/`. A folder-mirror clone rebuilds the database from these
 * files: export writes them, import reads them back parents first.
 *
 * Rows travel as `row_to_json` text, not as typed values, so timestamps keep
 * their full precision and the import reads them back unchanged.
 *
 * Limit (0.9.2): restoreSyncTables is for a fresh clone, or for resuming one that
 * stopped partway. It refuses a database holding rows the folder does not have. A
 * re-pull into an existing workspace keeps the incremental folder import
 * (previewFolderImport + applyFolderImport).
 */

export type SyncRow = Record<string, unknown>;

/** The one database call this module needs; the test database and the app's connection both fit. */
export interface SyncSql {
  sql: <T = Record<string, unknown>>(query: string, params?: unknown[]) => Promise<T[]>;
}

/**
 * Synced tables in foreign-key order: each table comes after every table its
 * rows point at. Self-references (`SELF_REFERENCE`) are handled per row.
 * The order is checked against the real foreign keys by
 * `sync-tables-fk-order.test.ts`.
 */
export const SYNC_TABLES = [
  "projects",
  "experiment_metric_names",
  "papers",
  "tags",
  "paper_tags",
  "vault_pages",
  "reading_lists",
  "report_sections",
  "reading_list_items",
  "screening_decisions",
  "paper_relations",
  "experiments",
  "experiment_metric_points",
  "experiment_metric_chunks",
  "milestones",
  "log_entries",
  "paper_field_defs",
  "paper_field_values",
  "paper_locus_anchors",
  "reader_annotations",
  "annotation_pins",
  "annotation_quotation_types",
  "citation_alert_tracks",
  "lab_snapshots",
  "blob_objects",
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

/** The column of a table that points at another row of the same table. */
export const SELF_REFERENCE: Partial<Record<SyncTable, string>> = {
  vault_pages: "parent_id",
  reading_lists: "parent_id",
  report_sections: "parent_id",
  reading_list_items: "duplicate_of_item_id",
};

/** Composite primary keys. Every other synced table is keyed by `id`. */
const COMPOSITE_KEY: Partial<Record<SyncTable, readonly string[]>> = {
  paper_tags: ["paper_id", "tag_id", "source"],
  experiment_metric_points: ["experiment_id", "metric_id", "step"],
  experiment_metric_chunks: ["experiment_id", "metric_id", "chunk_no"],
};

/** The primary-key columns of a synced table: a stable row order for paged reads. */
export function syncKeyColumns(table: SyncTable): readonly string[] {
  return COMPOSITE_KEY[table] ?? ["id"];
}

export function syncTableFile(table: string): string {
  return `.weaveforge/tables/${table}.json`;
}

/**
 * Folder files for every synced table, path to JSON text. A table with no rows is
 * written as `[]`. Rows are sorted by their text, so an unchanged table writes the
 * same bytes and the folder's history shows only real changes.
 */
export function syncTableFolderFiles(rows: Partial<Record<SyncTable, SyncRow[]>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const table of SYNC_TABLES) {
    const texts = (rows[table] ?? []).map((row) => JSON.stringify(row)).sort();
    // One row per line, so a changed row is a changed line in the folder's history.
    out[syncTableFile(table)] = texts.length === 0 ? "[]" : `[\n${texts.join(",\n")}\n]\n`;
  }
  return out;
}

/** Rows back from folder files. A missing file is left out; a corrupt one throws rather than importing nothing. */
export function syncTableRowsFromFolder(
  folder: Readonly<Record<string, string>>,
): Partial<Record<SyncTable, SyncRow[]>> {
  const out: Partial<Record<SyncTable, SyncRow[]>> = {};
  for (const table of SYNC_TABLES) {
    const text = folder[syncTableFile(table)];
    if (text !== undefined) out[table] = JSON.parse(text) as SyncRow[];
  }
  return out;
}

/** All rows of one synced table. The app reads through its PostgREST client; tests read through SQL. */
export type SyncTableReader = (table: SyncTable) => Promise<SyncRow[]>;

/** A reader over a SQL connection: one `row_to_json` select per table. */
export function sqlTableReader(db: SyncSql): SyncTableReader {
  return async (table) => {
    const rows = await db.sql<{ row: SyncRow }>(`select row_to_json(t) as row from ${table} t`);
    return rows.map((r) => r.row);
  };
}

export async function exportSyncTables(read: SyncTableReader): Promise<Record<SyncTable, SyncRow[]>> {
  const out = {} as Record<SyncTable, SyncRow[]>;
  for (const table of SYNC_TABLES) out[table] = await read(table);
  return out;
}

/**
 * Every table read twice; the export is returned once two passes agree, so a write
 * that lands during the read cannot leave the folder with rows from two moments.
 */
export async function exportSyncTablesStable(
  read: SyncTableReader,
  attempts = 3,
): Promise<Record<SyncTable, SyncRow[]>> {
  let previous = await exportSyncTables(read);
  for (let i = 1; i < attempts; i++) {
    const next = await exportSyncTables(read);
    if (JSON.stringify(next) === JSON.stringify(previous)) return next;
    previous = next;
  }
  throw new Error("The database changed while the folder was being written. Try the sync again.");
}

export async function importSyncTables(
  db: SyncSql,
  files: Partial<Record<SyncTable, SyncRow[]>>,
): Promise<void> {
  for (const table of SYNC_TABLES) {
    const columns = await writableColumns(db, table);
    const list = columns.map((c) => `"${c}"`).join(", ");
    const rows = orderBySelfReference(files[table] ?? [], SELF_REFERENCE[table]);
    for (const row of rows) {
      // Stored generated columns (e.g. paper_tags.id) are recomputed by the database, so they are not written.
      // OVERRIDING SYSTEM VALUE keeps identity columns as exported.
      await db.sql(
        `insert into ${table} (${list}) overriding system value
         select ${list} from json_populate_record(null::${table}, $1::json)`,
        [JSON.stringify(row)],
      );
    }
  }
}

/** Columns a row can be written to: everything except stored generated columns. */
async function writableColumns(db: SyncSql, table: string): Promise<string[]> {
  const rows = await db.sql<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'
     order by ordinal_position`,
    [table],
  );
  return rows.map((r) => r.column_name);
}

/**
 * Put rows so each row comes after the row its `column` points at. Rows whose
 * parent is not in the list (or is null) can go first. A cycle cannot be
 * imported in any order and throws.
 */
export function orderBySelfReference(rows: SyncRow[], column: string | undefined): SyncRow[] {
  if (!column) return rows;
  const ids = new Set(rows.map((r) => String(r.id)));
  const placed = new Set<string>();
  const out: SyncRow[] = [];
  let pending = rows;
  while (pending.length > 0) {
    const next: SyncRow[] = [];
    for (const row of pending) {
      const parent = row[column];
      const waiting = parent != null && ids.has(String(parent)) && !placed.has(String(parent));
      if (waiting) {
        next.push(row);
      } else {
        out.push(row);
        placed.add(String(row.id));
      }
    }
    if (next.length === pending.length) {
      throw new Error(`sync rows form a cycle through ${column}`);
    }
    pending = next;
  }
  return out;
}

/** Stored generated columns of synced tables. The database computes them, so an insert leaves them out. */
export const OMITTED_GENERATED: Partial<Record<SyncTable, readonly string[]>> = {
  vault_pages: ["body_preview"],
  paper_tags: ["id"],
};

/** The reads and writes a restore needs from a store, whether PostgREST or a test double. */
export interface SyncTableStore {
  /** True when the table has no rows for this user yet. */
  isEmpty(table: SyncTable): Promise<boolean>;
  /** The key columns (`syncKeyColumns`) of every row the table holds for this user. */
  keys(table: SyncTable): Promise<SyncRow[]>;
  insert(table: SyncTable, rows: SyncRow[]): Promise<void>;
}

const INSERT_CHUNK = 500;

/** A row's primary key as one string, so folder rows and stored rows compare by key. */
function keyOf(row: SyncRow, table: SyncTable): string {
  return JSON.stringify(syncKeyColumns(table).map((c) => String(row[c])));
}

/**
 * Restore every synced table into a store, parents first. Retryable: a store that
 * already holds some folder rows (from a restore that failed halfway) gets only the
 * rows it lacks. A stored row the folder does not have is refused before any insert,
 * so the restore never silently keeps or overwrites rows it did not write.
 */
export async function restoreSyncTables(
  tables: Partial<Record<SyncTable, SyncRow[]>>,
  store: SyncTableStore,
): Promise<void> {
  const missing: Partial<Record<SyncTable, SyncRow[]>> = {};
  for (const table of SYNC_TABLES) {
    const folderRows = tables[table] ?? [];
    const folderKeys = new Set(folderRows.map((r) => keyOf(r, table)));
    const storedKeys = new Set((await store.keys(table)).map((r) => keyOf(r, table)));
    if ([...storedKeys].some((k) => !folderKeys.has(k))) {
      throw new Error(`Cannot restore: ${table} already has rows the folder does not have. Restore into an empty database.`);
    }
    missing[table] = folderRows.filter((r) => !storedKeys.has(keyOf(r, table)));
  }
  for (const table of SYNC_TABLES) {
    const omitted = new Set(OMITTED_GENERATED[table] ?? []);
    const rows = orderBySelfReference(missing[table] ?? [], SELF_REFERENCE[table])
      .map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !omitted.has(k))));
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await store.insert(table, rows.slice(i, i + INSERT_CHUNK));
    }
  }
}
