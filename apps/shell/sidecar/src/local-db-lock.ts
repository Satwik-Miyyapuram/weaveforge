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

/**
 * How long an unreadable lock is given to be written. `wx` creates the file
 * before its contents land, so a lock read in that gap is someone's fresh lock.
 */
const UNWRITTEN_GRACE_MS = 5_000;

function modifiedAt(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * A holder that is gone, or wrote its lock before this boot (its pid may be
 * reused). An unreadable lock is stale once it is older than the write grace.
 */
function stale(file: string, holder: LockHolder | null, now: Date): boolean {
  if (!holder) return now.getTime() - modifiedAt(file) > UNWRITTEN_GRACE_MS;
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
    if (!stale(file, holder, now)) throw new DatabaseInUseError(dataDir, holder ?? unwritten(file));
    takeOverStale(dataDir, file, now);
  }
  throw new Error(`could not take the database lock ${file}`);
}

function unwritten(file: string): LockHolder {
  return { pid: 0, app: "Another WeaveForge", at: new Date(modifiedAt(file)).toISOString() };
}

/**
 * Remove a stale lock without racing another process doing the same (37-02).
 * Deleting by path could delete a fresh lock that replaced the stale one after
 * we read it, so move whatever is there aside under a name only we use, check
 * that what we moved is still stale, and put it back if it is not.
 */
function takeOverStale(dataDir: string, file: string, now: Date): void {
  const aside = `${file}.${process.pid}.${Date.now()}.stale`;
  try {
    fs.renameSync(file, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const moved = readHolder(aside);
  if (moved?.pid === process.pid || stale(aside, moved, now)) {
    fs.rmSync(aside, { force: true });
    return;
  }
  // We moved someone's live lock: restore it unless yet another one is there.
  try {
    fs.linkSync(aside, file);
  } catch {
    // A newer lock already holds the path; ours stays refused either way.
  }
  fs.rmSync(aside, { force: true });
  throw new DatabaseInUseError(dataDir, moved ?? unwritten(aside));
}

/** Drop the lock if this process holds it; never someone else's. */
export function releaseDbLock(dataDir: string): void {
  const file = lockPath(dataDir);
  if (readHolder(file)?.pid === process.pid) fs.rmSync(file, { force: true });
}
