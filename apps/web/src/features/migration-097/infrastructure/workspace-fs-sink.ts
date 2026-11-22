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
export function workspaceFsAsSink(fs: IWorkspaceFs): FileSink {
  return {
    async write(path, data) {
      const clean = norm(path);
      const slash = clean.lastIndexOf("/");
      if (slash > 0) await fs.mkdirp(clean.slice(0, slash));
      await fs.writeFile(clean, data);
    },
    async list() {
      const names: string[] = [];
      for await (const entry of fs.walk("")) names.push(norm(entry.path));
      return names;
    },
    readText: (path) => fs.readText(norm(path)),
    readBytes: (path) => fs.readFile(norm(path)),
    async rename(from, to) {
      await fs.rename(norm(from), norm(to));
    },
    async remove(path) {
      const clean = norm(path);
      if ((await fs.stat(clean)) === null) throw new Error(`no such file: ${clean}`);
      await fs.remove(clean);
    },
  };
}