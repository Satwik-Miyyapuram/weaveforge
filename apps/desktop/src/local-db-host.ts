import fs from "node:fs";
import path from "node:path";
import { LOCAL_BOOTSTRAP_SQL, type Migration } from "@weaveforge/core";
import { LocalDatabase, type LocalClient } from "./local-db";
import type { IpcResult } from "./channels";

/**
 * The local database as the rest of this process sees it: one function that
 * answers a query, and nothing else.
 *
 * Opened on the first query rather than at boot, because a person who never
 * leaves the network never needs it and a WASM Postgres costs a second to
 * start. Opened once: the promise is the lock, so two queries arriving together
 * wait on the same migration run instead of racing to apply it twice.
 */

const OPEN_FAILED = "The local database could not be opened.";
const HEALTHY = "The local database opened normally; there is nothing to reset.";
const BAD_QUERY = "A query is a string of SQL and a list of plain values.";

/**
 * What a parameter may be. Anything else is a structured clone away from a
 * lie. Bytes are in: a bytea column (the CRDT log) takes nothing else, and the
 * structured clone carries a `Uint8Array` across whole.
 */
type Param = string | number | boolean | null | Uint8Array;

function validParams(value: unknown): value is Param[] {
  return (
    Array.isArray(value) &&
    value.every(
      (p) =>
        p === null || p instanceof Uint8Array || ["string", "number", "boolean"].includes(typeof p),
    )
  );
}

/** Read the migrations shipped beside this bundle, in name order. */
function readMigrations(dir: string): Migration[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }));
}

export interface LocalDbHostOptions {
  /** Opens the engine. Injected so this file never imports PGlite itself. */
  open: () => Promise<LocalClient>;
  /**
   * Where the shipped `.sql` files are, in the order they apply.
   *
   * Two directories, not one: the shared migrations are the server's own, and
   * the device-only ones (the outbox, the watermark) come after them. Names are
   * unique per directory but not across them, so what the ledger records is
   * the directory's name and the file's name together.
   */
  migrations: readonly string[];
  /** Where the data lives. Reported to the page, so a person can find it. */
  dataDir: string;
  /**
   * Move the data directory out of the way so the next open starts fresh.
   *
   * Injected, like `open`, because how a directory is moved is the shell's
   * business — on Windows a failed engine can still hold handles, and the move
   * may have to wait for a relaunch. Whatever it does, it must never delete:
   * the directory being moved is somebody's data, unreadable or not.
   */
  discard: () => Promise<void>;
}

/** What the page can know about the database without querying it. */
export interface LocalDbState {
  /** Why the last open failed, or `null` if it has not failed. */
  failure: string | null;
  dataDir: string;
}

/** An open that failed, told apart from a query that did. */
class OpenError extends Error {
  constructor(cause: unknown) {
    super(`${OPEN_FAILED} ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export class LocalDbHost {
  private opening: Promise<LocalDatabase> | undefined;
  /**
   * The last open failure, kept so `state()` can report it and `reset()` can
   * refuse to touch a database that never failed. Cleared by a reset.
   */
  private failure: string | undefined;

  constructor(private readonly options: LocalDbHostOptions) {}

  private database(): Promise<LocalDatabase> {
    this.opening ??= (async () => {
      // Held outside the promise's own value, because the value is exactly what
      // is lost when this fails: the promise is rejected, nothing else refers
      // to the client, and a half-open engine is left with a lock on the data
      // directory. Migrating on top of one is how the *second* open ends up
      // fighting the first for the same files.
      let client: LocalClient | undefined;
      try {
        client = await this.options.open();
        const db = new LocalDatabase(client);
        const migrations = this.options.migrations.flatMap((dir) =>
          readMigrations(dir).map((m) => ({ ...m, name: `${path.basename(dir)}/${m.name}` })),
        );
        await db.migrate(LOCAL_BOOTSTRAP_SQL, migrations);
        await db.ensureLocalUser();
        return db;
      } catch (error) {
        // Closed before the field is cleared, and cleared only once the close
        // has settled: a retry that starts while the old engine is still
        // shutting down is the race this is here to avoid. A failed close is
        // swallowed -- the open failed, and that is the error worth reporting;
        // the original throw is re-raised below either way.
        if (client) await client.close().catch(() => undefined);
        this.opening = undefined;
        const failed = new OpenError(error);
        this.failure = failed.message;
        throw failed;
      }
    })();
    return this.opening;
  }

  /**
   * Run one statement for the renderer.
   *
   * The user id is not taken from the renderer. It cannot be: a page that could
   * name whoever it liked would be naming the identity that row-level security
   * is about to trust. Until sign-in exists here, every query runs as the
   * local-only user, which is what `LocalDatabase` does when told nothing.
   */
  async query(sql: unknown, params: unknown): Promise<IpcResult<unknown[]>> {
    if (typeof sql !== "string" || !sql.trim() || !validParams(params ?? [])) {
      return { ok: false, message: BAD_QUERY };
    }
    try {
      const db = await this.database();
      const { rows } = await db.query<unknown>(sql, (params as Param[] | undefined) ?? []);
      return { ok: true, value: rows };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : OPEN_FAILED };
    }
  }

  state(): LocalDbState {
    return { failure: this.failure ?? null, dataDir: this.options.dataDir };
  }

  /**
   * Move the unopenable database aside, so the next query starts a new one.
   *
   * Refused unless an open has actually failed: a page that could reset a
   * working database would be a page that could make a person's data
   * disappear from the app with one call. The failure is cleared only once
   * the move succeeded, so a move that fails leaves the button where it was
   * and the person can try again after reading why.
   */
  async reset(): Promise<IpcResult<null>> {
    if (this.failure === undefined) return { ok: false, message: HEALTHY };
    try {
      await this.options.discard();
      this.failure = undefined;
      return { ok: true, value: null };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Close if it was ever opened; quitting should not start a database. */
  async close(): Promise<void> {
    const opened = this.opening;
    this.opening = undefined;
    // Optional, not a non-null assertion: a close that races a failed open
    // finds nothing to await. The failure path above has already cleared the
    // field and closed the client it managed to make, so there is nothing here
    // to do -- and quitting is not the moment to raise about it.
    const db = await opened?.catch(() => undefined);
    await db?.close();
  }
}
