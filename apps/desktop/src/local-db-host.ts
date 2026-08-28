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
const BAD_QUERY = "A query is a string of SQL and a list of plain values.";

/** What a parameter may be. Anything else is a structured clone away from a lie. */
type Param = string | number | boolean | null;

function validParams(value: unknown): value is Param[] {
  return (
    Array.isArray(value) &&
    value.every((p) => p === null || ["string", "number", "boolean"].includes(typeof p))
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
}

export class LocalDbHost {
  private opening: Promise<LocalDatabase> | undefined;

  constructor(private readonly options: LocalDbHostOptions) {}

  private database(): Promise<LocalDatabase> {
    this.opening ??= (async () => {
      const db = new LocalDatabase(await this.options.open());
      const migrations = this.options.migrations.flatMap((dir) =>
        readMigrations(dir).map((m) => ({ ...m, name: `${path.basename(dir)}/${m.name}` })),
      );
      await db.migrate(LOCAL_BOOTSTRAP_SQL, migrations);
      await db.ensureLocalUser();
      return db;
    })().catch((error) => {
      // A failed open must not be remembered as the answer, or every later
      // query fails on a database that a restart might well have opened.
      this.opening = undefined;
      throw error;
    });
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

  /** Close if it was ever opened; quitting should not start a database. */
  async close(): Promise<void> {
    const opened = this.opening;
    this.opening = undefined;
    if (opened) await (await opened).close();
  }
}
