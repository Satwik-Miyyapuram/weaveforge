import fs from "node:fs";
import path from "node:path";

/**
 * Copies of the local database, kept where losing the database cannot reach.
 *
 * The data directory is a WASM Postgres on a real disk, and a run that is cut
 * off at the wrong moment — a force-quit, a crash, the power — can leave it in
 * a state no later boot can open (`local-db-reset.ts` is what happens then).
 * Moving the broken directory aside keeps the bytes, but bytes nobody can open
 * are not somebody's notes. So the database is also written out whole, as the
 * tarball PGlite can load back into a fresh directory, and kept in two places:
 * under the app's own directory, and under the workspace folder's `.weaveforge/`
 * when one is chosen — which is a folder the person picked, that uninstalling
 * the app does not touch.
 *
 * A backup is taken only when something has been written since the last one,
 * on a timer and on the way out. The newest few are kept per place; older ones
 * go, because a database that is 300 MB on disk is 40 MB gzipped and that adds
 * up. What is here never opens a database: it is given a dump and a file name,
 * and it reads one back. Restoring is the shell's business (`main.ts`), because
 * that is where the engine is opened.
 */

/** The slice of the engine a backup needs: PGlite's `dumpDataDir`. */
export interface Dumpable {
  dumpDataDir(compression: "gzip"): Promise<Blob>;
}

export interface LocalDbBackupsOptions {
  /**
   * Where backups go, asked each time: the workspace folder can be chosen or
   * forgotten while the app runs, and a place that does not exist yet is made.
   */
  dirs: () => readonly string[];
  /** How many to keep in each place. */
  keep?: number;
  now?: () => Date;
}

const PREFIX = "local-db-";
const SUFFIX = ".tar.gz";
export const DEFAULT_KEEP = 3;

/** The file a backup taken at `now` is named: sortable, legal everywhere. */
export function backupFileName(now: Date): string {
  return `${PREFIX}${now.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "")}${SUFFIX}`;
}

function isBackup(name: string): boolean {
  return name.startsWith(PREFIX) && name.endsWith(SUFFIX);
}

/** The backups in `dir`, newest first; none for a directory that is not there. */
async function listBackups(dir: string): Promise<string[]> {
  const names = await fs.promises.readdir(dir).catch(() => [] as string[]);
  return names
    .filter(isBackup)
    .sort()
    .reverse()
    .map((name) => path.join(dir, name));
}

export class LocalDbBackups {
  private readonly keep: number;
  private readonly now: () => Date;

  constructor(private readonly options: LocalDbBackupsOptions) {
    this.keep = options.keep ?? DEFAULT_KEEP;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Dump `source` into every place, and prune each to `keep`.
   *
   * One dump, written to each place: the dump is the slow part. Written beside
   * and renamed over, so a backup that was interrupted is a `.part` file the
   * listing ignores rather than a truncated tarball a restore would trust.
   * A place that cannot be written (a network folder that has gone away) is
   * skipped, not fatal: the other place still gets its copy. Returns the files
   * that were written.
   */
  async take(source: Dumpable): Promise<string[]> {
    const dirs = this.options.dirs();
    if (dirs.length === 0) return [];
    const bytes = new Uint8Array(await (await source.dumpDataDir("gzip")).arrayBuffer());
    const name = backupFileName(this.now());
    const written: string[] = [];
    for (const dir of dirs) {
      const file = path.join(dir, name);
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(`${file}.part`, bytes);
        await fs.promises.rename(`${file}.part`, file);
        written.push(file);
        await this.prune(dir);
      } catch {
        await fs.promises.rm(`${file}.part`, { force: true }).catch(() => undefined);
      }
    }
    return written;
  }

  /** The newest backup in any place, or `null` when there is none. */
  async latest(): Promise<string | null> {
    const all: string[] = [];
    for (const dir of this.options.dirs()) all.push(...(await listBackups(dir)));
    if (all.length === 0) return null;
    // Newest by name, not by place: the stamp is the same clock everywhere.
    all.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
    return all[0]!;
  }

  private async prune(dir: string): Promise<void> {
    const files = await listBackups(dir);
    for (const file of files.slice(this.keep)) {
      await fs.promises.rm(file, { force: true }).catch(() => undefined);
    }
  }
}

/** A backup's bytes, in the shape `PGlite.create({ loadDataDir })` takes. */
export async function readBackup(file: string): Promise<Blob> {
  const bytes = await fs.promises.readFile(file);
  return new Blob([bytes], { type: "application/gzip" });
}
