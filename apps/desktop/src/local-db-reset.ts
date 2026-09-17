import fs from "node:fs";
import path from "node:path";

/**
 * Moving an unopenable database out of the way, without deleting it.
 *
 * The directory is renamed to a sibling — `local-db.broken-<time>` — so that
 * the next open finds nothing and starts fresh, and so that whatever the old
 * one held is still on disk for anyone who wants to try recovering it. This
 * file never removes a directory.
 *
 * On Windows the rename can fail: a WASM Postgres that aborted part-way
 * through starting may still hold file handles, and NTFS refuses to rename a
 * directory with open files in it. There is nothing to be done about that from
 * inside the same process, so the move is written down in a marker file and
 * performed at the start of the next boot, before the engine has touched
 * anything. The caller relaunches when it sees `"deferred"`.
 */

export type MoveOutcome = "moved" | "deferred";

/** The sibling the directory becomes. Sortable, and legal on every filesystem. */
export function asidePath(dataDir: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  return `${dataDir}.broken-${stamp}`;
}

/** Where a deferred move is written down: beside the directory, not inside it. */
export function markerPath(dataDir: string): string {
  return `${dataDir}.move-aside`;
}

/**
 * Move now if the filesystem allows it, otherwise arrange for it at next boot.
 *
 * A directory that does not exist is already out of the way; that is a
 * success, not an error, because the open that failed may have failed before
 * creating it.
 */
export async function moveAside(dataDir: string, now: Date = new Date()): Promise<MoveOutcome> {
  if (!fs.existsSync(dataDir)) return "moved";
  const target = asidePath(dataDir, now);
  try {
    await fs.promises.rename(dataDir, target);
    return "moved";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // EPERM and EBUSY are the handle-held cases; anything else is a real
    // filesystem problem and is worth showing rather than deferring forever.
    if (code !== "EPERM" && code !== "EBUSY") throw error;
    await fs.promises.writeFile(markerPath(dataDir), target, "utf8");
    return "deferred";
  }
}

/**
 * Perform a move the previous run could not. Called once, before the engine
 * opens. A marker with no directory behind it is stale and simply removed.
 */
export function applyDeferredMove(dataDir: string): void {
  const marker = markerPath(dataDir);
  if (!fs.existsSync(marker)) return;
  const target = fs.readFileSync(marker, "utf8").trim();
  // The target must be a sibling this module would have named; a marker that
  // says anything else was not written here and is not acted on.
  const legit = path.dirname(target) === path.dirname(dataDir) && path.basename(target).startsWith(`${path.basename(dataDir)}.broken-`);
  if (legit && fs.existsSync(dataDir)) fs.renameSync(dataDir, target);
  fs.rmSync(marker, { force: true });
}
