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
   * Write the whole data directory to `file` as a gzipped tarball, for a
   * backup (`local-db-backup.ts`, `local-db-tar.ts`). Optional: a client
   * that cannot is simply never backed up.
   */
  dumpTo?(file: string): Promise<void>;
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
    try {
      await this.client.exec(bootstrap);
      await this.client.exec(LEDGER);
      const { rows } = await this.client.query<{ name: string }>(
        "select name from weaveforge_migrations",
      );
      const applied = new Set(rows.map((row) => row.name));
      // Each migration and its ledger row commit together (37-19): a crash
      // between the two used to leave a schema change with no record, and the
      // next boot ran it again over itself. The row goes in first, so a file
      // that brings its own `begin; ... commit;` (0099) commits it as well.
      return await applyMigrations(
        migrations,
        async (sql, name) => {
          try {
            await this.client.exec("BEGIN");
            await this.client.query("insert into weaveforge_migrations (name) values ($1)", [name]);
            await this.client.exec(sql);
            await this.client.exec("COMMIT");
          } catch (error) {
            await this.client.exec("ROLLBACK").catch(() => undefined);
            throw error;
          }
        },
        { applied },
      );
    } catch (error) {
      await this.client.exec("ROLLBACK").catch(() => undefined);
      throw error;
    }
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
    return this.recovering(() =>
      this.client.transaction(async (tx) => {
        // Transaction-local, so the claim, the role and the query travel
        // together; set outside one, they are gone before the query runs.
        await tx.query(
          "select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)",
          [claims],
        );
        return tx.query<T>(sql, params);
      }),
    );
  }

  /**
   * Run `fn`, and if the connection was found stuck in a failed transaction,
   * roll it back and run `fn` once more.
   *
   * PGlite is one connection for the whole app, and its `transaction()` sends
   * BEGIN before its own try block: once anything leaves that connection in an
   * aborted transaction, every later BEGIN fails and nothing ever sends the
   * ROLLBACK that would end it. Every query then reports "current transaction
   * is aborted" until the app restarts. Retrying is safe because that error
   * means this statement never ran.
   */
  private async recovering<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!isAbortedTransaction(error)) throw error;
      try {
        await this.client.exec("ROLLBACK");
      } catch {
        // The rollback's own failure says less than the error that sent us here.
        throw error;
      }
      return fn();
    }
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
    await this.recovering(() => this.client.query(
      `insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing`,
      [LOCAL_USER_ID, "local@weaveforge.invalid"],
    ));
  }

  /**
   * Who this device's queries run as: the account it syncs with once it has
   * been adopted, the local-only user before that.
   *
   * Adoption re-owns every row to the account. Queries that still claimed to
   * be the local user would then see none of them, so the identity has to
   * follow the rows. Read as the database owner, since `sync_state` is the
   * device's own bookkeeping; a database without it has never synced.
   *
   * Any other error is thrown, not read as "never synced": the caller caches
   * the answer, and an adopted device that ran as the local user would see
   * none of its rows and write new ones under the wrong owner.
   */
  async deviceUser(): Promise<string> {
    try {
      const { rows } = await this.recovering(() =>
        this.client.query<{ account_id: string | null }>("select account_id from sync_state limit 1"),
      );
      return rows[0]?.account_id ?? LOCAL_USER_ID;
    } catch (error) {
      if (isUndefinedTable(error)) return LOCAL_USER_ID;
      await this.client.exec("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  /** Write a copy of everything to `file`; `false` from a client that cannot. */
  async dumpTo(file: string): Promise<boolean> {
    if (!this.client.dumpTo) return false;
    await this.client.dumpTo(file);
    return true;
  }

  /** Whether this client can be backed up at all. */
  get canDump(): boolean {
    return typeof this.client.dumpTo === "function";
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

/** Postgres's 42P01: the table does not exist. */
function isUndefinedTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "42P01";
}

/** Postgres's 25P02: the connection is inside a transaction that already failed. */
function isAbortedTransaction(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "25P02" || (typeof message === "string" && /current transaction is aborted/i.test(message));
}
