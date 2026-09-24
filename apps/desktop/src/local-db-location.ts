import fs from "node:fs";
import path from "node:path";

/**
 * Where the database lives, and the one-time move that puts it beside the notes.
 *
 * ## Why this file exists at all
 *
 * The reader asked for one place: the folder they picked holds their database
 * and their markdown, so backing the folder up backs up the app. The first
 * attempt at that lived in `main.ts`, ran its move on **every launch**, and
 * destroyed the database in a loop — 129 unopenable directories and a relaunch
 * every three seconds, each pass throwing away a working 318 MB database in
 * favour of a 48 MB backup. That is the failure this file is written around.
 *
 * The dump-and-load itself was never the problem; measured in isolation, it
 * round trips correctly. What was wrong was **where it ran and what happened
 * when it failed**: a fallible, destructive operation on the boot path of the
 * thing it can destroy, with `recover` waiting to throw the result away.
 *
 * ## The three rules
 *
 * 1. **Once, ever.** A marker in the workspace records that the move has been
 *    attempted for that folder. It is never attempted twice, so a failure is a
 *    permanent, quiet fallback to the app directory rather than a loop.
 * 2. **The source is never deleted.** If the move fails, the app directory still
 *    holds a database that opens. Only the half-written *destination* is
 *    removed, because a directory left there would be found and trusted later.
 * 3. **The destination is proven before it is adopted.** After writing it, it is
 *    opened again from scratch and the schema version is read back. A directory
 *    that loads but does not reopen is the exact failure that went unnoticed, so
 *    it is checked here rather than assumed.
 *
 * A source that will not open is not a reason to fail the move — it is a reason
 * to leave it alone and say so, because the caller may still be able to restore
 * it from a backup.
 */

/** A PGlite directory that was initialized: this is the file it writes last-ish. */
const PG_VERSION = "PG_VERSION";

/**
 * Whether `dir` looks like an initialized PGlite data directory.
 *
 * **Necessary but not sufficient, and confusing it for sufficient is the bug
 * that made this feature destructive twice.** A directory can carry `PG_VERSION`
 * and still be unopenable — a copy interrupted part-way, or one whose engine was
 * still running when it was written. `databaseDirFor` therefore does not decide
 * on this alone; it is the cheap pre-filter, and {@link verify} is the answer.
 */
export function isDatabase(dir: string): boolean {
  return fs.existsSync(path.join(dir, PG_VERSION));
}

/**
 * Whether the database at `dir` can actually be opened.
 *
 * Injected rather than imported so this module needs no engine of its own, and
 * because "can it open" is exactly the question the shell already knows how to
 * ask. A caller with no way to check gets `false`: an unverifiable database is
 * not one to stake the reader's data on.
 */
export type VerifyDatabase = (dir: string) => Promise<boolean>;

/** Where the record of an attempted move is kept, inside the workspace. */
function markerFor(workspaceMetaDir: string): string {
  return path.join(workspaceMetaDir, "db-relocated");
}

export interface RelocateOptions {
  /** The app's own data directory — the source, and the permanent fallback. */
  appDir: string;
  /** The workspace's `<root>/.weaveforge` — the destination's parent. */
  workspaceMetaDir: string;
  /** Injected so tests do not need a real PGlite. */
  dump?: (sourceDir: string) => Promise<{ bytes: unknown; close: () => Promise<void> }>;
  /** Injected: opens the destination from bytes, then closes it. */
  load?: (targetDir: string, bytes: unknown) => Promise<void>;
  /** Injected: opens the destination with no bytes and reads one row. */
  verify?: (targetDir: string) => Promise<boolean>;
}

/**
 * Where the database actually is: the workspace when it is *usable*, else the app's.
 *
 * `isDatabase` is not enough and this is the fix for the second crash loop this
 * feature caused. A 318 MB database copied into the workspace was present, named
 * correctly and openable — but the engine could not open it at boot because a
 * process being replaced still held it, and the guard trusted the name. Every
 * launch then tried the same directory, failed, and let `recover` move it aside.
 *
 * So the directory is **verified before it is chosen**, and a copy that will not
 * open is skipped in favour of the app's own directory. That is a temporary
 * fallback rather than a permanent one: the marker is not written, so once the
 * lock clears the workspace copy is used again on the next launch.
 */
export async function databaseDirFor(
  appDir: string,
  workspaceMetaDir: string | null,
  verify?: VerifyDatabase,
): Promise<string> {
  if (!workspaceMetaDir) return appDir;
  const target = path.join(workspaceMetaDir, "db");
  if (!isDatabase(target)) return appDir;
  if (!verify) return target;
  const usable = await verify(target).catch(() => false);
  return usable ? target : appDir;
}

/**
 * Move the database into the workspace, once, and only if that is safe.
 *
 * Returns the directory the caller should open. Never throws: a folder that
 * cannot hold the database is not a reason to refuse the folder or to fail the
 * launch, so every failure is a log line and a fallback.
 */
export async function relocateDatabaseOnce(
  options: RelocateOptions,
): Promise<{ dir: string; moved: boolean; note: string }> {
  const { appDir, workspaceMetaDir } = options;
  const target = path.join(workspaceMetaDir, "db");
  const marker = markerFor(workspaceMetaDir);

  // Already in the workspace: nothing to do, and nothing to check. This is the
  // steady state for every launch after a successful move.
  if (isDatabase(target)) return { dir: target, moved: false, note: "already in the workspace folder" };

  // Attempted before for this folder. Whatever happened, it is not retried —
  // and the app directory is what we open.
  if (fs.existsSync(marker)) {
    return { dir: appDir, moved: false, note: "a move was attempted for this folder before; using the app directory" };
  }

  if (!isDatabase(appDir)) {
    return { dir: appDir, moved: false, note: "no database in the app directory to move" };
  }

  if (!options.dump || !options.load || !options.verify) {
    return { dir: appDir, moved: false, note: "no engine available to move the database with" };
  }

  try {
    fs.mkdirSync(workspaceMetaDir, { recursive: true });

    const { bytes, close } = await options.dump(appDir);
    await close();

    await options.load(target, bytes);

    // Rule 3: the destination has to reopen on its own before it is trusted.
    if (!(await options.verify(target))) {
      throw new Error("the moved database did not reopen cleanly");
    }

    // Written only on success, so a failure is retried for a *different* folder
    // and never for this one again.
    fs.writeFileSync(marker, `moved\n`, "utf8");
    return { dir: target, moved: true, note: "moved into the workspace folder" };
  } catch (error) {
    // Rule 2: remove the destination, never the source. A half-written target
    // would be found by `isDatabase` on a later launch and opened as if it were
    // the reader's database.
    await fs.promises.rm(target, { recursive: true, force: true }).catch(() => undefined);
    // Marked so this is not attempted again for this folder.
    try {
      fs.mkdirSync(workspaceMetaDir, { recursive: true });
      fs.writeFileSync(marker, `failed: ${String(error)}\n`, "utf8");
    } catch {
      // A workspace that cannot even hold the marker is one the move could not
      // have used anyway; the next launch will try once more and fail the same
      // way, which is bounded and not a loop, because the app keeps working.
    }
    return { dir: appDir, moved: false, note: `the move failed and will not be retried for this folder: ${String(error)}` };
  }
}
