import { Console } from "node:console";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { errorMessage } from "@weaveforge/core";
import type { LocalClient } from "../../../desktop/src/local-db";
import { LocalDbHost } from "../../../desktop/src/local-db-host";
import { acquireDbLock, DatabaseInUseError, releaseDbLock } from "../../../desktop/src/local-db-lock";
import { prepareDataDir } from "../../../desktop/src/local-db-prepare";
import { engineStartParams } from "../../../desktop/src/local-db-engine-params";
import { dumpOnDisk } from "../../../desktop/src/local-db-tar";
import { serve, type Handlers } from "./wire";

/** Parsed command line. */
export interface SidecarArgs { dataDir: string; migrations: string[] }

/** `--data-dir <dir>` once (required) and `--migrations <dir>` one or more times (at least one). */
export function parseArgs(argv: readonly string[]): SidecarArgs | string {
  let dataDir: string | undefined;
  const migrations: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--data-dir" || arg === "--migrations") {
      const value = argv[i + 1];
      if (value === undefined) return `${arg} needs a value`;
      i++;
      if (arg === "--data-dir") dataDir = path.resolve(value);
      else migrations.push(path.resolve(value));
    } else {
      return `unknown argument: ${arg}`;
    }
  }
  if (dataDir === undefined) return "missing --data-dir";
  if (migrations.length === 0) return "missing --migrations";
  return { dataDir, migrations };
}

/** The calls the shell can make. */
export function sidecarHandlers(host: Pick<LocalDbHost, "query" | "state">): Handlers {
  return {
    query: async (params) => {
      const p = params as { sql?: unknown; params?: unknown } | null;
      if (typeof p !== "object" || p === null || typeof p.sql !== "string" ||
        (p.params !== undefined && !Array.isArray(p.params))) {
        throw new Error("query needs { sql, params? }");
      }
      const r = await host.query(p.sql, p.params ?? []);
      if (r.ok) return r.value;
      throw new Error(r.message);
    },
    state: async () => host.state(),
    stats: async () => ({
      pid: process.pid,
      rss: process.memoryUsage().rss,
      heapUsed: process.memoryUsage().heapUsed,
    }),
  };
}

/** Start the engine on `dataDir`. Same as the desktop `openEngine`, without a backup blob. */
async function openEngine(dir: string): Promise<LocalClient> {
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
    startParams: engineStartParams(PGlite.defaultStartParams),
  });
  return Object.assign(engine, {
    dumpTo: (file: string) => dumpOnDisk(engine, dir, file),
  }) as unknown as LocalClient;
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
  const { dataDir, migrations } = parsed;

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

  const host = new LocalDbHost({
    open: () => openEngine(dataDir),
    migrations,
    dataDir: () => dataDir,
    discard: async () => {
      throw new Error("reset is not supported in the sidecar yet");
    },
    log: (l) => process.stderr.write(l + "\n"),
  });
  try {
    await serve(process.stdin, process.stdout, sidecarHandlers(host));
  } finally {
    try {
      await host.close();
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
