import type { IWorkspaceFs, WorkspaceStat } from "@weaveforge/core";

/** `fs` seen from one folder: paths go in and come out relative to it. "" is `fs` itself. */
export function scopedWorkspaceFs(fs: IWorkspaceFs, folder: string): IWorkspaceFs {
  if (folder === "") return fs;
  const prefix = `${folder}/`;
  const into = (path: string) => (path === "" ? folder : prefix + path);
  const outOf = (stat: WorkspaceStat): WorkspaceStat => ({
    ...stat,
    path: stat.path === folder ? "" : stat.path.startsWith(prefix) ? stat.path.slice(prefix.length) : stat.path,
  });
  const scoped: IWorkspaceFs = {
    readFile: (path) => fs.readFile(into(path)),
    readText: (path) => fs.readText(into(path)),
    writeFile: (path, data) => fs.writeFile(into(path), data),
    remove: (path, options) => fs.remove(into(path), options),
    mkdirp: (path) => fs.mkdirp(into(path)),
    list: async (dir) => (await fs.list(into(dir))).map(outOf),
    async *walk(dir) {
      for await (const stat of fs.walk(into(dir))) yield outOf(stat);
    },
    stat: async (path) => {
      const stat = await fs.stat(into(path));
      return stat && outOf(stat);
    },
    rename: (from, to) => fs.rename(into(from), into(to)),
  };
  if (fs.writeTextIf) scoped.writeTextIf = (path, text, expected) => fs.writeTextIf!(into(path), text, expected);
  return scoped;
}
