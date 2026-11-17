/**
 * Brings the 0.8 (Electron, PGlite) local database over into native Postgres.
 *
 * Runs only while the shell reports old data that is not yet imported. The old
 * data directory is read, never written. Tables go over one at a time, parents
 * before children, and the shell is told to finish only after every table has
 * succeeded. A failure throws before the finish, so no marker is written and a
 * retry runs the whole import again (the shell skips rows already in place).
 *
 * Nothing crosses the bridge as one huge value: the tar arrives in parts, rows
 * are read a page at a time, and a big table goes over in several sends, the
 * last one flagged so the shell marks the table done only then. A table without
 * a primary key goes in one send, since a retry could not skip its rows.
 */

/** One part of the old database tar, as the shell sends it. */
export interface OldDbTarPart {
  /** This part's bytes, base64. */
  data: string;
  /** How many parts the tar has. */
  parts: number;
}

/** The shell commands this import calls. */
export interface OldDbShell {
  status(): Promise<boolean>;
  tarPart(index: number): Promise<OldDbTarPart>;
  importTable(table: string, rows: unknown[], last: boolean): Promise<unknown>;
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
  /** Opens the old data directory, given as a tar. */
  open(tar: Blob): Promise<OldDbDatabase>;
  onProgress?(progress: OldDbProgress): void;
  /** Rows read per query. */
  pageRows?: number;
  /** A send closes once its rows' JSON reaches this many characters. */
  sendChars?: number;
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
  const db = await deps.open(await readTar(deps.shell));
  try {
    const tables = await tablesParentFirst(db);
    const keyed = await keyedTables(db);
    await importUserIds(deps, db);
    for (const [i, table] of tables.entries()) {
      deps.onProgress?.({ table, index: i + 1, total: tables.length });
      await importTable(deps, db, table, keyed.has(table));
    }
    await deps.shell.finish([AUTH_USERS, ...tables]);
    return { imported: true, tables };
  } finally {
    await db.close().catch(() => {});
  }
}

/** Opens the tar in PGlite. The package loads only here, so the import can be tested without it. */
export async function openOldDb(tar: Blob): Promise<OldDbDatabase> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = await PGlite.create({ loadDataDir: tar });
  return {
    query: (sql) => pg.query<Record<string, unknown>>(sql),
    close: () => pg.close(),
  };
}

const PAGE_ROWS = 200;
const SEND_CHARS = 8 << 20;
const AUTH_USERS = "auth.users";

/**
 * Sends the old `auth.users` ids before any table, since old rows reference them by foreign key.
 * Only ids go over: the other columns take their defaults, and the local user already there is skipped.
 */
async function importUserIds(deps: OldDbDeps, db: OldDbDatabase): Promise<void> {
  const { rows } = await db.query("SELECT id::text AS id FROM auth.users ORDER BY id");
  await deps.shell.importTable(
    AUTH_USERS,
    rows.map((row) => ({ id: String(row.id) })),
    true,
  );
}

/** Fetches the tar part by part; each part is decoded before the next arrives. */
async function readTar(shell: OldDbShell): Promise<Blob> {
  const first = await shell.tarPart(0);
  const parts: BlobPart[] = [base64ToBytes(first.data) as BlobPart];
  for (let i = 1; i < first.parts; i++) {
    parts.push(base64ToBytes((await shell.tarPart(i)).data) as BlobPart);
  }
  return new Blob(parts);
}

/**
 * Reads `table` a page at a time (in ctid order, so each page starts where the
 * last ended) and sends the rows in parts of about `sendChars` characters. The
 * final send carries `last`, even when it is empty. A keyless table is sent in
 * one call.
 */
async function importTable(
  deps: OldDbDeps,
  db: OldDbDatabase,
  table: string,
  keyed: boolean,
): Promise<void> {
  const pageRows = deps.pageRows ?? PAGE_ROWS;
  const sendChars = deps.sendChars ?? SEND_CHARS;
  let batch: unknown[] = [];
  let chars = 0;
  let after = "(0,0)";
  for (;;) {
    const { rows } = await db.query(
      `SELECT ctid::text AS ${CTID}, * FROM ${quoteIdent(table)} ` +
        `WHERE ctid > '${after}'::tid ORDER BY ctid LIMIT ${pageRows}`,
    );
    for (const { [CTID]: ctid, ...row } of rows) {
      after = String(ctid);
      const encoded = encodeRow(row);
      batch.push(encoded);
      chars += JSON.stringify(encoded).length;
      if (keyed && chars >= sendChars) {
        await deps.shell.importTable(table, batch, false);
        batch = [];
        chars = 0;
      }
    }
    if (rows.length < pageRows) break;
  }
  await deps.shell.importTable(table, batch, true);
}

/** Column name for the row position; no app table has a column by this name. */
const CTID = "__wf_ctid";

const KEYED_SQL = `SELECT c.relname AS tablename
FROM pg_index i
JOIN pg_class c ON c.oid = i.indrelid
WHERE i.indisprimary AND c.relnamespace = 'public'::regnamespace`;

/** The public tables that have a primary key. */
async function keyedTables(db: OldDbDatabase): Promise<Set<string>> {
  return new Set((await db.query(KEYED_SQL)).rows.map((r) => String(r.tablename)));
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
