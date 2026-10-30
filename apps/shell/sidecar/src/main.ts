import { Console } from "node:console";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { errorMessage } from "@weaveforge/core";
import type { LocalDbHost } from "../../../desktop/src/local-db-host";
import { acquireDbLock, DatabaseInUseError, releaseDbLock } from "../../../desktop/src/local-db-lock";
import { BACKUP_EVERY_MS, createLifecycle } from "./lifecycle";
import { serve, type Handlers } from "./wire";

/** Parsed command line. */
export interface SidecarArgs { dataDir: string; migrations: string[]; backupsDir: string }

/** `--data-dir <dir>` and `--backups <dir>` once (required), `--migrations <dir>` one or more times (at least one). */
export function parseArgs(argv: readonly string[]): SidecarArgs | string {
  let dataDir: string | undefined;
  let backupsDir: string | undefined;
  const migrations: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--data-dir" || arg === "--migrations" || arg === "--backups") {
      const value = argv[i + 1];
      if (value === undefined) return `${arg} needs a value`;
      i++;
      if (arg === "--data-dir") dataDir = path.resolve(value);
      else if (arg === "--backups") backupsDir = path.resolve(value);
      else migrations.push(path.resolve(value));
    } else {
      return `unknown argument: ${arg}`;
    }
  }
  if (dataDir === undefined) return "missing --data-dir";
  if (migrations.length === 0) return "missing --migrations";
  if (backupsDir === undefined) return "missing --backups";
  return { dataDir, migrations, backupsDir };
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
  const { dataDir, migrations, backupsDir } = parsed;

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
  // Unref so the timer alone never keeps the process alive.
  setInterval(() => void lc.backUp(), BACKUP_EVERY_MS).unref();
  try {
    await serve(process.stdin, process.stdout, sidecarHandlers({ host: lc.host, restartWanted: lc.restartWanted }));
  } finally {
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
