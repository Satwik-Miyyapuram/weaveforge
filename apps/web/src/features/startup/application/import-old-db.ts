/**
 * Brings the 0.8 (Electron, PGlite) local database over into native Postgres.
 *
 * Runs only while the shell reports old data that is not yet imported. The old
 * data directory is read, never written. Tables go over one at a time, parents
 * before children, and the shell is told to finish only after every table has
 * succeeded. A failure throws before the finish, so no marker is written and a
 * retry runs the whole import again (the shell skips rows already in place).
 */

/** The shell commands this import calls. */
export interface OldDbShell {
  status(): Promise<boolean>;
  tar(): Promise<string>;
  importTable(table: string, rows: unknown[]): Promise<unknown>;
  finish(tables: string[]): Promise<void>;
}

export interface OldDbQueryResult {
  rows: Record<string, unknown>[];
}

/** The part of PGlite this import uses. */
export interface OldDbDatabase {
  query(sql: string): Promise<OldDbQueryResult>;
  close(): Promise<void>;
}

export interface OldDbProgress {
  table: string;
  index: number;
  total: number;
}

export interface OldDbDeps {
  shell: OldDbShell;
  /** Opens the old data directory, given as the bytes of a tar. */
  open(tar: Uint8Array): Promise<OldDbDatabase>;
  onProgress?(progress: OldDbProgress): void;
}

export type OldDbOutcome =
  | { imported: false }
  | { imported: true; tables: string[] };

/**
 * Imports every table of the old database, then tells the shell to finish.
 * Resolves `{ imported: false }` without touching the database when there is
 * nothing to import.
 */
export async function importOldDb(deps: OldDbDeps): Promise<OldDbOutcome> {
  if (!(await deps.shell.status())) return { imported: false };
  const db = await deps.open(base64ToBytes(await deps.shell.tar()));
  try {
    const tables = await tablesParentFirst(db);
    for (const [i, table] of tables.entries()) {
      deps.onProgress?.({ table, index: i + 1, total: tables.length });
      const { rows } = await db.query(`SELECT * FROM ${quoteIdent(table)}`);
      await deps.shell.importTable(table, rows.map(encodeRow));
    }
    await deps.shell.finish(tables);
    return { imported: true, tables };
  } finally {
    await db.close().catch(() => {});
  }
}

/** Opens the tar in PGlite. The package loads only here, so the import can be tested without it. */
export async function openOldDb(tar: Uint8Array): Promise<OldDbDatabase> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = await PGlite.create({ loadDataDir: new Blob([tar as BlobPart]) });
  return {
    query: (sql) => pg.query<Record<string, unknown>>(sql),
    close: () => pg.close(),
  };
}

const TABLES_SQL =
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename";

const FOREIGN_KEYS_SQL = `SELECT c.relname AS child, p.relname AS parent
FROM pg_constraint k
JOIN pg_class c ON c.oid = k.conrelid
JOIN pg_class p ON p.oid = k.confrelid
WHERE k.contype = 'f'
  AND c.relnamespace = 'public'::regnamespace
  AND p.relnamespace = 'public'::regnamespace`;

/**
 * Every public table, each after the tables it references. A cycle (rare) falls
 * back to name order for the rest; the shell then reports any foreign key that
 * fails, and the import stops there without finishing.
 */
async function tablesParentFirst(db: OldDbDatabase): Promise<string[]> {
  const all = (await db.query(TABLES_SQL)).rows.map((r) => String(r.tablename));
  const known = new Set(all);
  const pending = new Map(all.map((t) => [t, new Set<string>()]));
  for (const row of (await db.query(FOREIGN_KEYS_SQL)).rows) {
    const child = String(row.child);
    const parent = String(row.parent);
    if (child !== parent && known.has(parent)) pending.get(child)?.add(parent);
  }
  const order: string[] = [];
  while (pending.size > 0) {
    const ready = [...pending]
      .filter(([, parents]) => parents.size === 0)
      .map(([table]) => table)
      .sort();
    const next = ready.length > 0 ? ready : [...pending.keys()].sort();
    for (const table of next) pending.delete(table);
    for (const parents of pending.values()) {
      for (const table of next) parents.delete(table);
    }
    order.push(...next);
  }
  return order;
}

/** Tagged wire form for the values PGlite returns that JSON cannot carry: bigint and bytea. */
function encodeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, encodeValue(value)]),
  );
}

function encodeValue(value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Uint8Array) return { $bytes: bytesToBase64(value) };
  return value;
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

const CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
