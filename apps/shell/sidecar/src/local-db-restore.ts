import fs from "node:fs";
import path from "node:path";

/**
 * Rebuilding the data directory from a backup that is proven to open.
 *
 * A backup is a tarball of whatever was on disk, so a directory that was already
 * corrupt yields corrupt backups (2026-10-08: all three were). Each candidate is
 * unpacked into a scratch sibling and opened there; only one that opens is renamed
 * into place, and the next older one is tried otherwise.
 */

const RESTORE = ".restore-";

export function restoreDirFor(dataDir: string, now: Date = new Date()): string {
  return `${dataDir}${RESTORE}${now.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "")}`;
}

/** Best effort: a load that aborted inside PGlite can leave handles open on Windows (ENOTEMPTY). */
function discard(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`[local-db] could not remove ${dir} (${String(error)}); cleared on next open`);
  }
}

/** Scratch directories a crashed restore left; ours alone, so they are removed. */
export function clearRestoreLeftovers(dataDir: string): void {
  const parent = path.dirname(dataDir);
  const prefix = `${path.basename(dataDir)}${RESTORE}`;
  for (const name of fs.existsSync(parent) ? fs.readdirSync(parent) : []) {
    if (name.startsWith(prefix)) discard(path.join(parent, name));
  }
}

/**
 * Put the newest backup that opens at `dataDir`, which must not exist.
 * `load` unpacks `file` into `dir` and opens it, throwing if it cannot.
 * Returns the backup used, or `null` when none opened.
 */
export async function restoreNewestGood(
  dataDir: string,
  backups: readonly string[],
  load: (dir: string, file: string) => Promise<void>,
  now: () => Date = () => new Date(),
): Promise<string | null> {
  if (fs.existsSync(dataDir)) throw new Error(`refusing to restore over ${dataDir}`);
  for (const [i, file] of backups.entries()) {
    // Unique per attempt, so an undeletable leftover never blocks the next one.
    const scratch = `${restoreDirFor(dataDir, now())}-${i}`;
    try {
      await load(scratch, file);
    } catch (error) {
      console.warn(`[local-db] backup ${file} does not open (${String(error)}); trying an older one`);
      discard(scratch);
      continue;
    }
    fs.renameSync(scratch, dataDir);
    return file;
  }
  return null;
}
