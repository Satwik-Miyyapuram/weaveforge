import type { IWorkspaceFs, WorkspaceStat } from "@weaveforge/core";
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
export function sinkAsWorkspaceFs(sink: FileSink): IWorkspaceFs {
  const fileNames = async (): Promise<string[]> => (await sink.list()).map(norm);

  async function exists(path: string): Promise<boolean> {
    return (await fileNames()).includes(norm(path));
  }

  async function statOf(path: string): Promise<WorkspaceStat | null> {
    const clean = norm(path);
    if (await exists(clean)) {
      const bytes = await sink.readBytes(clean);
      return { path: clean, size: bytes.byteLength, modifiedAt: NO_MTIME, kind: "file" };
    }
    const prefix = `${clean}/`;
    if ((await fileNames()).some((name) => name.startsWith(prefix))) {
      return { path: clean, size: 0, modifiedAt: NO_MTIME, kind: "dir" };
    }
    return null;
  }

  async function filesUnder(dir: string): Promise<WorkspaceStat[]> {
    const prefix = prefixOf(dir);
    const out: WorkspaceStat[] = [];
    for (const name of await fileNames()) {
      if (!name.startsWith(prefix)) continue;
      const bytes = await sink.readBytes(name);
      out.push({ path: name, size: bytes.byteLength, modifiedAt: NO_MTIME, kind: "file" });
    }
    return out;
  }

  return {
    async readFile(path) {
      return sink.readBytes(norm(path));
    },

    async readText(path) {
      return sink.readText(norm(path));
    },

    async writeFile(path, data) {
      await sink.write(norm(path), data);
    },

    async writeTextIf(path, text, expected) {
      const clean = norm(path);
      const present = await exists(clean);
      if (expected === null) {
        if (present) return false;
      } else {
        if (!present || (await sink.readText(clean)) !== expected) return false;
      }
      await sink.write(clean, text);
      return true;
    },

    async remove(path, options) {
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
      for (const name of await fileNames()) {
        if (!name.startsWith(prefix)) continue;
        const rest = name.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash === -1) {
          const bytes = await sink.readBytes(name);
          children.set(name, { path: name, size: bytes.byteLength, modifiedAt: NO_MTIME, kind: "file" });
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
      await sink.rename(norm(from), norm(to));
    },
  };
}
