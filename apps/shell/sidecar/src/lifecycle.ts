import fs from "node:fs";
import type { LocalClient } from "../../../desktop/src/local-db";
import {
  LocalDbBackups,
  readBackup,
} from "../../../desktop/src/local-db-backup";
import { engineStartParams } from "../../../desktop/src/local-db-engine-params";
import { LocalDbHost } from "../../../desktop/src/local-db-host";
import { DatabaseInUseError } from "../../../desktop/src/local-db-lock";
import { prepareDataDir } from "../../../desktop/src/local-db-prepare";
import {
  applyDeferredMove,
  claimRelaunch,
  clearRelaunch,
  moveAside,
  type MoveOutcome,
} from "../../../desktop/src/local-db-reset";
import {
  clearRestoreLeftovers,
  restoreNewestGood,
} from "../../../desktop/src/local-db-restore";
import { openWithRetry } from "../../../desktop/src/local-db-retry";
import { dumpOnDisk } from "../../../desktop/src/local-db-tar";

/** What the sidecar needs to run the database: where it is, where its migrations and backups are. */
export interface LifecycleOptions {
  dataDir: string;
  migrations: string[];
  backupsDir: string;
  /** Engine opener; tests pass a fake. Default: the real PGlite one (moved here from main.ts). */
  openEngine?: (loadDataDir?: Blob, dir?: string) => Promise<LocalClient>;
  /** Default: `moveAside` from local-db-reset. Tests pass a fake that returns "deferred". */
  moveAside?: (dataDir: string) => Promise<MoveOutcome>;
  log?: (line: string) => void;
  /** Open retry schedule. Default `OPEN_RETRY` (Electron's). Tests pass `{ attempts: 1, backoffMs: 0, maxBackoffMs: 0 }`. */
  retry?: { attempts: number; backoffMs: number; maxBackoffMs: number };
}

/** Electron's open schedule: about half a minute before an open counts as failed. */
export const OPEN_RETRY = { attempts: 10, backoffMs: 500, maxBackoffMs: 5000 };

export interface Lifecycle {
  host: LocalDbHost;
  /** Write a backup if anything changed; never throws, never opens the database. */
  backUp(): Promise<void>;
  /** Whether a move aside was deferred, so only a new sidecar process can finish it. */
  restartWanted(): boolean;
}

/** Backups are taken this often while something has changed (same as Electron). */
export const BACKUP_EVERY_MS = 10 * 60 * 1000;

/** Start the engine on `dir`, from a backup's bytes when given some. */
async function openEngine(
  dir: string,
  loadDataDir?: Blob,
): Promise<LocalClient> {
  prepareDataDir(dir);
  const { PGlite, types } = await import("@electric-sql/pglite");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const engine = await PGlite.create({
    dataDir: dir,
    extensions: { pgcrypto },
    parsers: {
      [types.DATE]: (x) => x,
      [types.TIMESTAMPTZ]: (x) => new Date(x).toISOString(),
    },
    ...(loadDataDir ? { loadDataDir } : {}),
    startParams: engineStartParams(PGlite.defaultStartParams),
  });
  // Same as the desktop: backups come from the files on disk, not PGlite's in-memory dump.
  return Object.assign(engine, {
    dumpTo: (file: string) => dumpOnDisk(engine, dir, file),
  }) as unknown as LocalClient;
}

/** The database host, its backups and its restore, as Electron runs them, minus the workspace folder. */
export function createLifecycle(options: LifecycleOptions): Lifecycle {
  const { dataDir, migrations, backupsDir } = options;
  const log = options.log ?? ((line: string) => console.warn(line));
  const retry = options.retry ?? OPEN_RETRY;
  const openDb =
    options.openEngine ??
    ((loadDataDir?: Blob, dir: string = dataDir) =>
      openEngine(dir, loadDataDir));
  const move = options.moveAside ?? moveAside;
  const backups = new LocalDbBackups({ dirs: () => [backupsDir] });
  // Set when a move was deferred: a relaunch in Electron, a restart of this process here.
  let restart = false;

  /** Rebuild the missing data directory from the newest backup that opens, then open it. */
  async function restoreAndOpen(): Promise<{
    client: LocalClient;
    from: string;
  } | null> {
    const from = await restoreNewestGood(
      dataDir,
      await backups.all(),
      async (dir, file) => {
        const client = await openDb(await readBackup(file), dir);
        try {
          await client.query("select 1");
        } finally {
          await client.close().catch(() => undefined);
        }
      },
    );
    if (!from) return null;
    const client = await openDb();
    clearRelaunch(dataDir);
    return { client, from };
  }

  const host = new LocalDbHost({
    migrations,
    dataDir: () => dataDir,
    open: async () => {
      // Before anything touches the directory: a previous run may have left a move or a scratch copy behind.
      clearRestoreLeftovers(dataDir);
      applyDeferredMove(dataDir);
      // No database, but a backup: the backup is what the person had, so it is what they get back.
      if (!fs.existsSync(dataDir)) {
        const restored = await restoreAndOpen();
        if (restored) {
          log(`[local-db] no database; restored from ${restored.from}`);
          return restored.client;
        }
      }
      const client = await openWithRetry(() => openDb(), {
        ...retry,
        giveUpOn: (cause) => cause instanceof DatabaseInUseError,
      });
      clearRelaunch(dataDir);
      return client;
    },
    recover: async (cause) => {
      // Another process has it open: nothing is broken, so nothing is moved.
      if (cause instanceof DatabaseInUseError) return null;
      const latest = await backups.latest();
      log(
        `[local-db] open failed (${String(cause)}); ${latest ? "restoring from a backup" : "no backup to restore from"}`,
      );
      if (!latest) return null;
      if ((await move(dataDir)) === "deferred") {
        // One restart per failure: a restarted process that fails again shows the error instead.
        if (claimRelaunch(dataDir)) restart = true;
        return null;
      }
      return restoreAndOpen();
    },
    discard: async () => {
      if ((await move(dataDir)) === "deferred") restart = true;
    },
    log,
  });

  /** Write a backup if anything changed; never throws, never opens the database. */
  async function backUp(): Promise<void> {
    try {
      const snapshot = await host.snapshot();
      if (!snapshot) return;
      const written = await backups.take(snapshot);
      if (written.length > 0)
        log(`[local-db] backed up to ${written.join(", ")}`);
    } catch (error) {
      log(`[local-db] backup failed: ${String(error)}`);
    }
  }

  return { host, backUp, restartWanted: () => restart };
}
