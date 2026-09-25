/**
 * The local database's lifetime in the shell: where it lives, how it opens,
 * how it is backed up, and the three channels the page reaches it by.
 *
 * Moved out of `main.ts` whole; the comments below are the ones it carried
 * there. `main.ts` hands over the two things it owns and this needs — the
 * workspace folder and the promise that says it has been restored — as
 * functions, because both are decided after this is created.
 */
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_META_DIR } from "@weaveforge/core";
import { CHANNELS } from "./channels";
import type { IpcSurface } from "./ipc-guard";
import type { LocalClient } from "./local-db";
import { LocalDbBackups, readBackup } from "./local-db-backup";
import { LocalDbHost } from "./local-db-host";
import { databaseDirFor, relocateDatabaseOnce } from "./local-db-location";
import { applyDeferredMove, moveAside } from "./local-db-reset";

export interface MainLocalDbDeps {
  ipc: IpcSurface;
  /** The chosen workspace folder, if there is one yet. */
  workspaceRoot: () => string | undefined;
  /** Settles once the folder from the last session has been taken back up. */
  rootRestored: () => Promise<void>;
}

export function registerMainLocalDb(deps: MainLocalDbDeps): {
  localDb: LocalDbHost;
  shutDownLocalDb: () => Promise<void>;
} {
  /**
   * The local database, under the app's own directory.
   *
   * See `appDbDir` below for why this is *not* the workspace folder — it was, and
   * the move corrupted the database and put the app in a relaunch loop. The
   * short version: relocating a live WASM Postgres is a dump-and-reload that can
   * fail, and it ran on every launch, which is the one place a destructive
   * operation must never be.
   *
   * PGlite is imported in `openEngine` and nowhere else, and lazily: it is a WASM
   * Postgres, and an app that stays online for its whole life should never pay to
   * load it.
   */
  const appDbDir = path.join(app.getPath("userData"), "local-db");
  /**
   * Where the database lives: the workspace folder when a move has landed,
   * otherwise the app's own directory.
   *
   * **This feature destroyed a database once; the guard rails are in
   * `local-db-location.ts`.** The short version, because it is worth not
   * repeating: the first attempt ran its move on *every launch*, on the boot path,
   * with `recover` waiting to throw the result away — so one failure became a
   * relaunch loop that left 129 unopenable directories and repeatedly discarded a
   * working 318 MB database in favour of a 48 MB backup. The dump-and-load itself
   * was fine; measured in isolation it round trips. Invoking it unconditionally,
   * and answering a failure with destruction, was not.
   *
   * Resolved once into `storageDir` and read from there afterwards, so the
   * directory is decided by one verified answer rather than recomputed by every
   * caller — including `databaseDirFor`'s own question, which is asynchronous
   * because answering it properly means opening the database.
   */
  let storageDir: string | null = null;
  const localDbDir = (): string => storageDir ?? appDbDir;
  
  /** Opens a directory and reads one row; the only honest test of "can it open". */
  async function verifyDatabase(dir: string): Promise<boolean> {
    const { PGlite } = await import("@electric-sql/pglite");
    const client = (await PGlite.create({ dataDir: dir })) as unknown as LocalClient;
    try {
      await client.query("select 1");
      return true;
    } finally {
      await client.close().catch(() => undefined);
    }
  }
  
  /**
   * Decide where the database is, moving it into the chosen folder if that has
   * never been attempted, and **only** trusting a copy that opens.
   *
   * Idempotent and safe to await more than once: the answer is cached. Called from
   * `open` before anything opens; every later caller reads `storageDir`.
   */
  async function ensureDatabaseLocation(): Promise<string> {
    const root = deps.workspaceRoot();
    if (!root) {
      storageDir = appDbDir;
      return storageDir;
    }
    const metaDir = path.join(root, WORKSPACE_META_DIR);
    const result = await relocateDatabaseOnce({
      appDir: appDbDir,
      workspaceMetaDir: metaDir,
      verify: verifyDatabase,
      dump: async (dir) => {
        const { PGlite } = await import("@electric-sql/pglite");
        const client = (await PGlite.create({ dataDir: dir })) as unknown as LocalClient & {
          dumpDataDir?: (c: "gzip") => Promise<Blob>;
        };
        if (typeof client.dumpDataDir !== "function") {
          await client.close();
          throw new Error("the engine cannot dump its data directory");
        }
        const bytes = await client.dumpDataDir("gzip");
        return { bytes, close: () => client.close() };
      },
      load: async (targetDir, bytes) => {
        const { PGlite } = await import("@electric-sql/pglite");
        const client = (await PGlite.create({
          dataDir: targetDir,
          loadDataDir: bytes as Blob,
        })) as unknown as LocalClient;
        await client.close();
      },
    });
    // A workspace copy that exists but will not open right now — a lock held by a
    // process being replaced, most often — falls back to the app's own database
    // for this launch. The marker is not written, so the next launch tries the
    // workspace again once the lock has cleared.
    storageDir = await databaseDirFor(appDbDir, metaDir, verifyDatabase);
    if (storageDir !== result.dir) {
      console.warn(`[local-db] the workspace copy did not open; using ${storageDir} for this launch`);
    }
    console.log(`[local-db] ${result.note}: ${storageDir}`);
    return storageDir;
  }
  
  
  
  /**
   * Copies of the database, under the app's directory and under the workspace
   * folder's `.weaveforge/` when there is one; see `local-db-backup.ts`. Taken
   * every so often while something has changed, and on the way out.
   */
  const BACKUP_EVERY_MS = 10 * 60 * 1000;
  const localDbBackups = new LocalDbBackups({
    dirs: () => {
      const dirs = [path.join(app.getPath("userData"), "local-db-backups")];
      const root = deps.workspaceRoot();
      if (root) dirs.push(path.join(root, ".weaveforge", "db-backups"));
      return dirs;
    },
  });
  
  /** Start the engine on the current data directory, from a backup's bytes when given some. */
  async function openEngine(loadDataDir?: Blob): Promise<LocalClient> {
    const { PGlite, types } = await import("@electric-sql/pglite");
    const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
    return (await PGlite.create({
      dataDir: localDbDir(),
      extensions: { pgcrypto },
      // Rows cross to the renderer shaped as PostgREST would send them, and the
      // repositories were written against that: a `date` is its `YYYY-MM-DD`
      // text and a timestamp is ISO text. PGlite's default turns both into
      // `Date` objects, which survive the bridge -- and a logbook entry's day
      // rendered as one was React's "objects are not valid as a child".
      parsers: {
        [types.DATE]: (x) => x,
        [types.TIMESTAMPTZ]: (x) => new Date(x).toISOString(),
      },
      ...(loadDataDir ? { loadDataDir } : {}),
    })) as unknown as LocalClient;
  }
  
  /**
   * `openEngine`, with three attempts before it admits defeat.
   *
   * A local Postgres holds a lock on its data directory, and the two situations
   * that produce a *transient* failure are both ordinary here: reconnecting a
   * folder while the previous install is still running, and a shutdown whose
   * engine has not finished releasing its files. Neither is a corrupt database,
   * and the caller's response to a failure — `recover`, which moves the directory
   * aside and rebuilds from a backup — is far too expensive to spend on them.
   *
   * The bound is what makes this safe: a genuinely unopenable directory still
   * reaches `recover` eventually rather than being retried forever.
   *
   * The schedule is deliberately not "three tries, 700 ms apart", which was the
   * first version and was wrong by an order of magnitude. Opening this database
   * means initializing a WASM Postgres over a directory that is hundreds of
   * megabytes; measured, that takes seconds, not milliseconds. Three attempts
   * spanning 1.4 seconds therefore gave up while a lock held by a process being
   * replaced was still clearing — and `recover` answers giving up by moving the
   * database aside and rebuilding from an older backup, so a *slow open* was being
   * read as a *broken database* and cost the reader their recent work.
   *
   * What matters is the total, not the count: roughly ten attempts backing off to
   * five seconds is about half a minute of patience, which outlasts any process
   * that is genuinely on its way out, and is still bounded.
   */
  const OPEN_ATTEMPTS = 10;
  const OPEN_BACKOFF_MS = 500;
  const OPEN_BACKOFF_MAX_MS = 5000;
  
  async function openEngineWithRetry(): Promise<LocalClient> {
    let last: unknown;
    for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt++) {
      try {
        return await openEngine();
      } catch (cause) {
        last = cause;
        if (attempt < OPEN_ATTEMPTS - 1) {
          const wait = Math.min(OPEN_BACKOFF_MS * 2 ** attempt, OPEN_BACKOFF_MAX_MS);
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
      }
    }
    console.warn(`[local-db] could not open after ${OPEN_ATTEMPTS} attempts: ${String(last)}`);
    throw last;
  }
  
  const localDb = new LocalDbHost({
    migrations: [
      path.join(__dirname, "migrations"),
      path.join(__dirname, "migrations-local"),
    ],
    dataDir: localDbDir,
    open: async () => {
      // The folder is taken up in the background at boot and the answer decides
      // where the database is, so this waits for it.
      await deps.rootRestored();
      // The once-ever move into the workspace folder, before anything opens. It
      // returns the directory to use either way, and after a successful move this
      // is a pure lookup — see `local-db-location.ts` for why it is shaped that
      // way rather than being a copy on every launch.
      await ensureDatabaseLocation();
      // A reset the previous run could only write down; see `local-db-reset.ts`.
      applyDeferredMove(localDbDir());
      // No database at all -- a fresh install, or a reset -- but a backup: the
      // backup is what the person had, so it is what they get back.
      if (!fs.existsSync(localDbDir())) {
        const latest = await localDbBackups.latest();
        if (latest) {
          console.log(`[local-db] no database; restoring from ${latest}`);
          return openEngine(await readBackup(latest));
        }
      }
      // The database exists, so a failure to open it here is a failure, not a
      // missing file -- and `recover` (below) answers a failure by throwing the
      // directory away and rebuilding from a backup, which is the most expensive
      // thing this file can do. It is worth three patient attempts first: a lock
      // held by a process that is still exiting clears in about a second, and
      // must not cost the reader their afternoon.
      return openEngineWithRetry();
    },
    recover: async (cause) => {
      const latest = await localDbBackups.latest();
      if (!latest) return null;
      console.warn(`[local-db] open failed (${String(cause)}); restoring from ${latest}`);
      // The engine that failed may still hold the directory. When it does, the
      // move waits for a process that has never opened it -- this one,
      // relaunched -- and that boot finds no directory and restores (above).
      if ((await moveAside(localDbDir())) === "deferred") {
        app.relaunch();
        app.exit(0);
        return null;
      }
      return { client: await openEngine(await readBackup(latest)), from: latest };
    },
    discard: async () => {
      // As in `recover`, for the button on the page.
      if ((await moveAside(localDbDir())) === "deferred") {
        app.relaunch();
        app.exit(0);
      }
    },
  });
  
  /** Write a backup if anything changed; never throws, never opens the database. */
  async function backUpLocalDb(): Promise<void> {
    try {
      const blob = await localDb.snapshot();
      if (!blob) return;
      const written = await localDbBackups.take({ dumpDataDir: async () => blob });
      if (written.length > 0) console.log(`[local-db] backed up to ${written.join(", ")}`);
    } catch (error) {
      console.warn(`[local-db] backup failed: ${String(error)}`);
    }
  }
  setInterval(() => void backUpLocalDb(), BACKUP_EVERY_MS).unref();
  
  /**
   * A last copy, then the close. Safe to run more than once: a database that is
   * already closed has nothing to snapshot and nothing to close, so an update —
   * which runs this before the installer is spawned — and the `will-quit` that
   * follows it do not fight over the same files.
   */
  const shutDownLocalDb = (): Promise<void> => backUpLocalDb().then(() => localDb.close());
  
  deps.ipc.handle(CHANNELS.dbQuery, (_event, sql: unknown, params: unknown) =>
    localDb.query(sql, params),
  );
  deps.ipc.handle(CHANNELS.dbState, () => ({ ok: true, value: localDb.state() }));
  deps.ipc.handle(CHANNELS.dbReset, () => localDb.reset());

  return { localDb, shutDownLocalDb };
}
