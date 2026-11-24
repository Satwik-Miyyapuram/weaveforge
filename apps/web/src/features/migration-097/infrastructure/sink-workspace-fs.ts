import type { IWorkspaceFs, WorkspaceStat } from "@weaveforge/core";
import { ConflictError } from "@weaveforge/core";
import type { FileSink } from "../domain/ports.ts";

/** Epoch stamp: a FileSink keeps no mtimes, and the export does not need them. */
const NO_MTIME = "1970-01-01T00:00:00.000Z";

/** POSIX-relative path inside the sink: no leading slash, no `..` escape. */
function norm(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split(String.fromCharCode(92)).join("/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") throw new Error(`path escapes the sink: ${path}`);
    parts.push(segment);
  }
  return parts.join("/");
}

/** Prefix that every entry under `dir` starts with ("" = whole sink). */
function prefixOf(dir: string): string {
  const clean = norm(dir);
  return clean === "" ? "" : `${clean}/`;
}

/**
 * Adapts a FileSink to IWorkspaceFs, so FILES repos can write their real
 * bytes into the export staging area. The sink is flat: directories exist
 * only as path prefixes, so mkdirp is a no-op.
 */
export function sinkAsWorkspaceFs(
  sink: FileSink,
  options: { compareAndSet?: boolean; cacheReads?: boolean } = {},
): IWorkspaceFs {
  const exists = (path: string): Promise<boolean> => sink.exists(norm(path));
  // cacheReads: repos that scan every paper per call read each file once. Any write, rename or remove through this
  // fs, and a compare-and-set that misses (an outside edit), drops the cache, so a re-read sees the disk.
  const texts = new Map<string, string>();
  const forget = () => texts.clear();

  /** Files under `dir`. A sink with a sized listing walks that folder only; others list all and read each file. */
  async function filesUnder(dir: string): Promise<WorkspaceStat[]> {
    const prefix = prefixOf(dir);
    const file = (path: string, size: number): WorkspaceStat => ({ path, size, modifiedAt: NO_MTIME, kind: "file" });
    if (sink.entries) {
      return (await sink.entries(norm(dir)))
        .map((entry) => file(norm(entry.path), entry.size))
        .filter((entry) => entry.path.startsWith(prefix));
    }
    const out: WorkspaceStat[] = [];
    for (const name of (await sink.list()).map(norm)) {
      if (name.startsWith(prefix)) out.push(file(name, (await sink.readBytes(name)).byteLength));
    }
    return out;
  }

  async function statOf(path: string): Promise<WorkspaceStat | null> {
    const clean = norm(path);
    if (await exists(clean)) {
      const bytes = await sink.readBytes(clean);
      return { path: clean, size: bytes.byteLength, modifiedAt: NO_MTIME, kind: "file" };
    }
    if (clean === "") return null;
    const under = sink.entries
      ? (await sink.entries(clean)).length > 0
      : (await sink.list()).map(norm).some((name) => name.startsWith(`${clean}/`));
    return under ? { path: clean, size: 0, modifiedAt: NO_MTIME, kind: "dir" } : null;
  }

  return {
    async readFile(path) {
      return sink.readBytes(norm(path));
    },

    async readText(path) {
      const clean = norm(path);
      const cached = texts.get(clean);
      if (cached !== undefined) return cached;
      const text = await sink.readText(clean);
      if (options.cacheReads) texts.set(clean, text);
      return text;
    },

    async writeFile(path, data) {
      forget();
      await sink.write(norm(path), data);
    },

    async writeTextIf(path, text, expected) {
      forget();
      const clean = norm(path);
      if (expected === null) {
        // Create-only: a file already at the path is never written over. The call reports true only when the text
        // reads back at this path, so a file that appears mid-call (kept as a conflict copy) reports false.
        if ((await sink.readText(clean).catch(() => null)) !== null) return false;
        await sink.write(clean, text);
        return (await sink.readText(clean).catch(() => null)) === text;
      }
      if (options.compareAndSet) return sink.writeIf(clean, text, expected);
      // Entity saves: the file must still read `expected`. The new text then goes through the sink's write, so a
      // differing user edit is kept and the DB version lands in a conflict copy. A save that became a conflict copy
      // (the file still reads `expected`) throws ConflictError, so the run lists it as a conflict and not as a write
      // failure. A file that changed again mid-call reports false, so the repo re-reads it.
      if ((await sink.readText(clean).catch(() => null)) !== expected) return false;
      await sink.write(clean, text);
      const after = await sink.readText(clean).catch(() => null);
      if (after === text) return true;
      if (after !== expected) return false;
      throw new ConflictError(`conflict: ${clean} differs; kept the file's version, the DB version is in a conflict copy`);
    },

    async remove(path, options) {
      forget();
      const clean = norm(path);
      if (await exists(clean)) {
        await sink.remove(clean);
        return;
      }
      const under = await filesUnder(clean);
      if (under.length === 0) throw new Error(`missing path: ${clean}`);
      if (!options?.recursive) throw new Error(`directory not empty: ${clean}`);
      for (const entry of under) await sink.remove(entry.path);
    },

    async mkdirp() {
      // Flat sink: a directory exists once a file sits under it.
    },

    async list(dir) {
      const prefix = prefixOf(dir);
      const children = new Map<string, WorkspaceStat>();
      for (const entry of await filesUnder(dir)) {
        const rest = entry.path.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash === -1) {
          children.set(entry.path, entry);
        } else {
          const dirPath = `${prefix}${rest.slice(0, slash)}`;
          children.set(dirPath, { path: dirPath, size: 0, modifiedAt: NO_MTIME, kind: "dir" });
        }
      }
      return [...children.values()];
    },

    async *walk(dir) {
      for (const entry of await filesUnder(dir)) yield entry;
    },

    stat(path) {
      return statOf(path);
    },

    async rename(from, to) {
      forget();
      await sink.rename(norm(from), norm(to));
    },
  };
}
