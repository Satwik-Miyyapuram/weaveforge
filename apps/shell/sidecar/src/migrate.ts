import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_META_DIR } from "@weaveforge/core";
import { acquireDbLock, DatabaseInUseError, releaseDbLock } from "../../../desktop/src/local-db-lock";
import { MIGRATED_MARKER } from "../../../desktop/src/migrated-notice";

/** Written into the new data dir when the copy is complete; its presence means "never again". */
export const DONE_MARKER = "migrated-from-electron";

/** What is copied from Electron's data dir, by name. `secrets.json` is not: Electron sealed it. */
export const ITEMS = [
  "local-db", "local-db-backups", "preferences.json", "models", "artifacts", "weaveforge.log", "overleaf-git",
] as const;

const STAGING_DIR = ".migrating";
const LOCK_APP = "weaveforge-migration";

export type MigrateOutcome =
  | { kind: "already" }
  | { kind: "nothing" }
  | { kind: "busy"; reason: string }
  | { kind: "done"; copied: string[] };

export interface MigrateOptions {
  /** Electron's userData dir. */
  oldDir: string;
  /** The new app's data dir (the parent of its `local-db`). */
  newDir: string;
  now?: Date;
  /** Copies one item; tests pass a failing one. Default: fs.cpSync recursive, errorOnExist, force false, preserveTimestamps. */
  copy?: (from: string, to: string) => void;
}

/** Copy Electron's data into the new dir once. Throws on an I/O failure (the caller must not open a database then). */
export function migrateFromElectron(options: MigrateOptions): MigrateOutcome {
  const { oldDir, newDir } = options;
  const now = options.now ?? new Date();
  if (fs.existsSync(path.join(newDir, DONE_MARKER))) return { kind: "already" };

  const present = ITEMS.filter((i) => fs.existsSync(path.join(oldDir, i)));
  if (present.length === 0) {
    writeDoneMarker(oldDir, newDir, now, []);
    return { kind: "nothing" };
  }

  const locked = takeLocks(dbDirsToLock(oldDir), now);
  if (!Array.isArray(locked)) return locked;

  // Markers are written while Electron is still locked out, so it cannot change its data unwarned in between.
  try {
    const copied = stageAndPublish(oldDir, newDir, present, options.copy ?? defaultCopy);
    fs.writeFileSync(path.join(oldDir, MIGRATED_MARKER), JSON.stringify({ to: newDir, at: now.toISOString() }));
    writeDoneMarker(oldDir, newDir, now, copied);
    return { kind: "done", copied };
  } finally {
    for (const dir of locked) releaseDbLock(dir);
  }
}

function defaultCopy(from: string, to: string): void {
  fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
}

/** Electron's live database dirs: its own, plus the workspace database when preferences name one. */
function dbDirsToLock(oldDir: string): string[] {
  const dirs = [path.join(oldDir, "local-db")];
  const workspaceDb = workspaceDbDir(oldDir);
  if (workspaceDb !== null) dirs.push(workspaceDb);
  return dirs;
}

function workspaceDbDir(oldDir: string): string | null {
  let root: unknown;
  try {
    const prefs = JSON.parse(fs.readFileSync(path.join(oldDir, "preferences.json"), "utf8")) as Record<string, unknown>;
    root = prefs["vault-root"];
  } catch {
    return null;
  }
  if (typeof root !== "string" || root === "") return null;
  const db = path.join(root, WORKSPACE_META_DIR, "db");
  return fs.existsSync(db) ? db : null;
}

/** Lock each dir, or return the busy outcome after releasing the ones taken. */
function takeLocks(dirs: string[], now: Date): string[] | MigrateOutcome {
  const taken: string[] = [];
  for (const dir of dirs) {
    try {
      acquireDbLock(dir, LOCK_APP, now);
      taken.push(dir);
    } catch (error) {
      for (const done of taken) releaseDbLock(done);
      if (error instanceof DatabaseInUseError) return { kind: "busy", reason: error.message };
      throw error;
    }
  }
  return taken;
}

/** Copy the items into a staging dir, then rename them into place only once every copy succeeded. */
function stageAndPublish(
  oldDir: string,
  newDir: string,
  present: readonly string[],
  copy: (from: string, to: string) => void,
): string[] {
  const staging = path.join(newDir, STAGING_DIR);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  // An item already in newDir was renamed there by a run that crashed before the done marker.
  const todo = present.filter((i) => !fs.existsSync(path.join(newDir, i)));
  for (const item of todo) copy(path.join(oldDir, item), path.join(staging, item));
  for (const item of todo) fs.renameSync(path.join(staging, item), path.join(newDir, item));
  fs.rmSync(staging, { recursive: true, force: true });
  return todo;
}

/** Written last, atomically, so a crash before it means the next start copies again. */
function writeDoneMarker(oldDir: string, newDir: string, now: Date, copied: string[]): void {
  fs.mkdirSync(newDir, { recursive: true });
  const file = path.join(newDir, DONE_MARKER);
  const body = {
    from: oldDir,
    at: now.toISOString(),
    copied,
    secretsLeftBehind: fs.existsSync(path.join(oldDir, "secrets.json")),
  };
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(body));
  fs.renameSync(`${file}.tmp`, file);
}
