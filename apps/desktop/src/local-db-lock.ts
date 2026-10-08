import fs from "node:fs";
import os from "node:os";

/**
 * One process per data directory.
 *
 * PGlite has no postmaster lock that another process honours, so two apps on one
 * directory each write WAL over the other's: on 2026-10-08 WeaveForge Dev and
 * WeaveForge both opened the workspace database, and pg_control ended up naming
 * a checkpoint the other had overwritten. The lock is a file beside the
 * directory, created exclusively, naming the holder.
 */

export interface LockHolder {
  pid: number;
  app: string;
  at: string;
}

export class DatabaseInUseError extends Error {
  constructor(
    readonly dataDir: string,
    readonly holder: LockHolder,
  ) {
    super(
      `${holder.app} (pid ${holder.pid}) already has this database open: ${dataDir}. ` +
        `Quit it, then try again.`,
    );
    this.name = "DatabaseInUseError";
  }
}

export function lockPath(dataDir: string): string {
  return `${dataDir}.lock`;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readHolder(file: string): LockHolder | null {
  try {
    const holder = JSON.parse(fs.readFileSync(file, "utf8")) as LockHolder;
    return typeof holder.pid === "number" ? holder : null;
  } catch {
    return null;
  }
}

/** A holder that is gone, or wrote its lock before this boot (its pid may be reused). */
function stale(holder: LockHolder | null, now: Date): boolean {
  if (!holder) return true;
  const bootedAt = now.getTime() - os.uptime() * 1000;
  if (Date.parse(holder.at) < bootedAt) return true;
  return holder.pid !== process.pid && !alive(holder.pid);
}

/**
 * Take the lock for this process, or throw `DatabaseInUseError` naming who has it.
 * Taking it again from the same process is a no-op.
 */
export function acquireDbLock(dataDir: string, app: string, now: Date = new Date()): void {
  const file = lockPath(dataDir);
  const mine: LockHolder = { pid: process.pid, app, at: now.toISOString() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(mine), { flag: "wx" });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const holder = readHolder(file);
    if (holder?.pid === process.pid) return;
    if (!stale(holder, now)) throw new DatabaseInUseError(dataDir, holder!);
    fs.rmSync(file, { force: true });
  }
  throw new Error(`could not take the database lock ${file}`);
}

/** Drop the lock if this process holds it; never someone else's. */
export function releaseDbLock(dataDir: string): void {
  const file = lockPath(dataDir);
  if (readHolder(file)?.pid === process.pid) fs.rmSync(file, { force: true });
}
