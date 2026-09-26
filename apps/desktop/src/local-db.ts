import { LOCAL_USER_ID, applyMigrations, sessionClaims, type Migration } from "@weaveforge/core";

/**
 * The database that exists whether or not anybody has an account.
 *
 * Postgres compiled to WASM, in the main process, holding its data under the
 * app's own directory. It matters that it is Postgres rather than SQLite with a
 * translation layer: the migrations are the same files the server runs, and
 * row-level security works, so the role switch the server-side runner performs
 * happens here too and policies are exercised rather than bypassed.
 *
 * The client is injected. Nothing here imports PGlite, which keeps this file
 * testable without a WASM boot and keeps the choice of engine in one place —
 * `main.ts`, which is the only file that should know where the data lives.
 */

/** The slice of PGlite's surface this uses; anything equivalent will do. */
export interface LocalClient {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (tx: LocalTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /**
   * The whole data directory as a tarball, for a backup (`local-db-backup.ts`).
   * Optional: a client that cannot is simply never backed up.
   */
  dumpDataDir?(compression: "gzip"): Promise<Blob>;
}

export interface LocalTransaction {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Where the record of applied migrations lives.
 *
 * Its own table rather than a file beside the data, so the record and the
 * schema it describes commit or roll back on the same disk. A file can survive
 * a database that did not.
 */
const LEDGER = `
create table if not exists weaveforge_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
)`;

export interface LocalQueryResult<T> {
  rows: T[];
}

export class LocalDatabase {
  constructor(private readonly client: LocalClient) {}

  /**
   * Bring the schema up to date, and say what that took.
   *
   * Idempotent: on every boot after the first this applies nothing and returns
   * an empty list. `bootstrap` is the scaffolding the migrations expect to find
   * already there, so it runs before them and is written to tolerate rerunning.
   */
  async migrate(bootstrap: string, migrations: readonly Migration[]): Promise<string[]> {
    await this.client.exec(bootstrap);
    await this.client.exec(LEDGER);
    const { rows } = await this.client.query<{ name: string }>(
      "select name from weaveforge_migrations",
    );
    const applied = new Set(rows.map((row) => row.name));
    return applyMigrations(migrations, (sql) => this.client.exec(sql), {
      applied,
      onApplied: async (name) => {
        await this.client.query("insert into weaveforge_migrations (name) values ($1)", [name]);
      },
    });
  }

  /**
   * Run one statement as a user, with policies in force.
   *
   * `undefined` for the user means the local-only identity — the case that is
   * true until somebody signs in — rather than "no identity", which would be a
   * request policies are entitled to refuse. Pass `null` explicitly for that.
   */
  async query<T>(sql: string, params: unknown[] = [], userId?: string | null): Promise<LocalQueryResult<T>> {
    const claims = sessionClaims(userId === undefined ? LOCAL_USER_ID : userId);
    return this.client.transaction(async (tx) => {
      // Transaction-local, so the claim, the role and the query travel
      // together; set outside one, they are gone before the query runs.
      await tx.query(
        "select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)",
        [claims],
      );
      return tx.query<T>(sql, params);
    });
  }

  /**
   * Make sure the local-only user exists as a row.
   *
   * Foreign keys point at `auth.users`, so the identity policies read has to be
   * a real row or the first insert on this device fails. Written on every boot
   * because the cost is one no-op statement and the alternative is a flag that
   * can disagree with the database.
   */
  async ensureLocalUser(): Promise<void> {
    await this.client.query(
      `insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`,
      [LOCAL_USER_ID, "local@weaveforge.invalid"],
    );
  }

  /**
   * Who this device's queries run as: the account it syncs with once it has
   * been adopted, the local-only user before that.
   *
   * Adoption re-owns every row to the account. Queries that still claimed to
   * be the local user would then see none of them, so the identity has to
   * follow the rows. Read as the database owner, since `sync_state` is the
   * device's own bookkeeping; a database without it has never synced.
   */
  async deviceUser(): Promise<string> {
    try {
      const { rows } = await this.client.query<{ account_id: string | null }>(
        "select account_id from sync_state limit 1",
      );
      return rows[0]?.account_id ?? LOCAL_USER_ID;
    } catch {
      return LOCAL_USER_ID;
    }
  }

  /** A copy of everything, or `null` from a client that cannot make one. */
  async dump(): Promise<Blob | null> {
    return this.client.dumpDataDir ? this.client.dumpDataDir("gzip") : null;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
