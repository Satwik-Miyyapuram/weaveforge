import type { IWorkspaceFs } from "@weaveforge/core";
import type { FileSink } from "../domain/ports.ts";

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

/**
 * Adapts an IWorkspaceFs (the OPFS root in the browser) to a FileSink, so the
 * web export can write its verified bytes into the real OPFS workspace.
 * The reverse of sinkAsWorkspaceFs. Parent directories are created on write.
 */
/** The slice of IWorkspaceFs the sink uses; BrowserWorkspaceFs and MemoryWorkspaceFs both fit. */
export type SinkFs = Pick<
  IWorkspaceFs,
  "mkdirp" | "writeFile" | "walk" | "readText" | "readFile" | "stat" | "rename" | "remove" | "writeTextIf"
>;

export function workspaceFsAsSink(fs: SinkFs): FileSink {
  return {
    async write(path, data) {
      const clean = norm(path);
      const slash = clean.lastIndexOf("/");
      if (slash > 0) await fs.mkdirp(clean.slice(0, slash));
      await fs.writeFile(clean, data);
    },
    async list() {
      const names: string[] = [];
      for await (const entry of fs.walk("")) if (entry.kind === "file") names.push(norm(entry.path));
      return names;
    },
    readText: (path) => fs.readText(norm(path)),
    readBytes: (path) => fs.readFile(norm(path)),
    async exists(path) {
      return (await fs.stat(norm(path)))?.kind === "file";
    },
    async writeIf(path, text, expected) {
      const clean = norm(path);
      // No compare-and-set on this workspace: refuse rather than write unchecked.
      if (!fs.writeTextIf) throw new Error(`no compare-and-set to write ${clean}`);
      return fs.writeTextIf(clean, text, expected);
    },
    async rename(from, to) {
      await fs.rename(norm(from), norm(to));
    },
    async remove(path) {
      const clean = norm(path);
      // The port removes one file; a missing path or a folder is an error, never a recursive delete.
      if ((await fs.stat(clean))?.kind !== "file") throw new Error(`ENOENT: no such file: ${clean}`);
      await fs.remove(clean);
    },
  };
}