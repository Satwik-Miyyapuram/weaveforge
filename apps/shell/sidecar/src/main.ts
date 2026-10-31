import { Console } from "node:console";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { errorMessage } from "@weaveforge/core";
import type { LocalDbHost } from "../../../desktop/src/local-db-host";
import { acquireDbLock, DatabaseInUseError, releaseDbLock } from "../../../desktop/src/local-db-lock";
import { BACKUP_EVERY_MS, createLifecycle } from "./lifecycle";
import { startLocalApi, type LocalApiStart } from "./local-api-start";
import { migrateFromElectron } from "./migrate";
import { createPeer, serve, type Handlers } from "./wire";

/** Parsed command line. */
export interface SidecarArgs {
  dataDir: string;
  migrations: string[];
  backupsDir: string;
  migrateFrom?: string;
  artifacts?: string;
  bridge?: string;
  appVersion?: string;
  homeVariant?: string;
}

/** `--data-dir <dir>` and `--backups <dir>` once (required), `--migrations <dir>` one or more times (at least one). */
export function parseArgs(argv: readonly string[]): SidecarArgs | string {
  let dataDir: string | undefined;
  let backupsDir: string | undefined;
  let migrateFrom: string | undefined;
  let artifacts: string | undefined;
  let bridge: string | undefined;
  let appVersion: string | undefined;
  let homeVariant: string | undefined;
  const migrations: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (
      arg === "--data-dir" || arg === "--migrations" || arg === "--backups" || arg === "--migrate-from" ||
      arg === "--artifacts" || arg === "--bridge" || arg === "--app-version" || arg === "--home-variant"
    ) {
      const value = argv[i + 1];
      if (value === undefined) return `${arg} needs a value`;
      i++;
      if (arg === "--data-dir") dataDir = path.resolve(value);
      else if (arg === "--backups") backupsDir = path.resolve(value);
      else if (arg === "--migrate-from") migrateFrom = path.resolve(value);
      else if (arg === "--artifacts") artifacts = path.resolve(value);
      else if (arg === "--bridge") bridge = path.resolve(value);
      else if (arg === "--app-version") appVersion = value;
      else if (arg === "--home-variant") homeVariant = value;
      else migrations.push(path.resolve(value));
    } else {
      return `unknown argument: ${arg}`;
    }
  }
  if (dataDir === undefined) return "missing --data-dir";
  if (migrations.length === 0) return "missing --migrations";
  if (backupsDir === undefined) return "missing --backups";
  const parsed: SidecarArgs = { dataDir, migrations, backupsDir };
  if (migrateFrom !== undefined) parsed.migrateFrom = migrateFrom;
  if (artifacts !== undefined) parsed.artifacts = artifacts;
  if (bridge !== undefined) parsed.bridge = bridge;
  if (appVersion !== undefined) parsed.appVersion = appVersion;
  if (homeVariant !== undefined) parsed.homeVariant = homeVariant;
  return parsed;
}

/** Copies Electron's data into `newDir` once; false when the sidecar must not open a database. */
function migrateOldData(oldDir: string, newDir: string): boolean {
  try {
    const outcome = migrateFromElectron({ oldDir, newDir });
    if (outcome.kind === "busy") {
      process.stderr.write(
        `weaveforge-sidecar: the old WeaveForge app is running; close it, then restart WeaveForge so its data can be copied (${outcome.reason})\n`,
      );
      process.exitCode = 3;
      return false;
    }
    process.stderr.write(`[migrate] ${JSON.stringify(outcome)}\n`);
    return true;
  } catch (e) {
    // Opening an empty database now would hide the user's data on every later start.
    process.stderr.write("weaveforge-sidecar: copying the old app's data failed: " + errorMessage(e) + "\n");
    process.exitCode = 1;
    return false;
  }
}

/** The calls the shell can make. */
export function sidecarHandlers(db: {
  host: Pick<LocalDbHost, "query" | "state" | "reset">;
  restartWanted(): boolean;
}): Handlers {
  return {
    query: async (params) => {
      const p = params as { sql?: unknown; params?: unknown } | null;
      if (typeof p !== "object" || p === null || typeof p.sql !== "string" ||
        (p.params !== undefined && !Array.isArray(p.params))) {
        throw new Error("query needs { sql, params? }");
      }
      // A deferred move is waiting for a fresh process: opening here would only fail and move again.
      if (db.restartWanted()) throw new Error("local database: restarting");
      const r = await db.host.query(p.sql, p.params ?? []);
      if (r.ok) return r.value;
      throw new Error(r.message);
    },
    state: async () => ({ ...db.host.state(), restart: db.restartWanted() }),
    reset: async () => {
      const r = await db.host.reset();
      if (!r.ok) throw new Error(r.message);
      return { restart: db.restartWanted() };
    },
    stats: async () => ({
      pid: process.pid,
      rss: process.memoryUsage().rss,
      heapUsed: process.memoryUsage().heapUsed,
    }),
  };
}

async function main(): Promise<void> {
  // stdout is the protocol, so diagnostics go to stderr.
  const toStderr = new Console({ stdout: process.stderr, stderr: process.stderr });
  console.log = toStderr.log;
  console.info = toStderr.info;
  console.debug = toStderr.debug;
  console.dir = toStderr.dir;
  console.dirxml = toStderr.dirxml;
  console.table = toStderr.table;
  const parsed = parseArgs(process.argv.slice(2));
  if (typeof parsed === "string") {
    process.stderr.write(`weaveforge-sidecar: ${parsed}\n`);
    process.exitCode = 2;
    return;
  }
  const { dataDir, migrations, backupsDir, migrateFrom } = parsed;

  if (migrateFrom !== undefined && !migrateOldData(migrateFrom, path.dirname(dataDir))) return;
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  try {
    // The lock stops a second process from writing the same PGlite files.
    acquireDbLock(dataDir, "weaveforge-sidecar");
  } catch (error) {
    if (error instanceof DatabaseInUseError) {
      process.stderr.write(error.message + "\n");
      process.exitCode = 3;
      return;
    }
    throw error;
  }

  const lc = createLifecycle({
    dataDir,
    migrations,
    backupsDir,
    log: (l) => process.stderr.write(l + "\n"),
  });
  const peer = createPeer(process.stdout);
  let api: LocalApiStart;
  try {
    api = startLocalApi(sidecarHandlers({ host: lc.host, restartWanted: lc.restartWanted }), {
      peer,
      localDb: lc.host,
      artifactRoot: parsed.artifacts ?? path.join(path.dirname(dataDir), "artifacts"),
      bridge: parsed.bridge ?? "",
      version: parsed.appVersion ?? "0.0.0",
      ...(parsed.homeVariant !== undefined ? { homeVariant: parsed.homeVariant } : {}),
      home: os.homedir(),
      platform: process.platform,
      appData: process.env.APPDATA,
      execPath: process.execPath,
      log: (l) => process.stderr.write(l + "\n"),
    });
  } catch (e) {
    process.stderr.write("weaveforge-sidecar: " + errorMessage(e) + "\n");
    process.exitCode = 1;
    try {
      await lc.host.close();
    } catch {
      // Already failing; the start error above is the one to report.
    }
    releaseDbLock(dataDir);
    // PGlite can keep handles alive, so exit explicitly.
    process.exit(1);
  }
  // Unref so the timer alone never keeps the process alive.
  setInterval(() => void lc.backUp(), BACKUP_EVERY_MS).unref();
  try {
    await serve(process.stdin, process.stdout, api.handlers, peer);
  } finally {
    await api.close();
    await lc.backUp();
    try {
      await lc.host.close();
    } catch (e) {
      process.stderr.write("weaveforge-sidecar: close failed: " + errorMessage(e) + "\n");
      process.exitCode = 1;
    }
    releaseDbLock(dataDir);
    // Let the last replies reach the pipe before exiting.
    await new Promise<void>((r) => process.stdout.write("", () => r()));
    // PGlite can keep handles alive, so exit explicitly.
    process.exit(process.exitCode ?? 0);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e: unknown) => {
    process.stderr.write("weaveforge-sidecar: " + errorMessage(e) + "\n");
    process.exit(1);
  });
}
