import type { IWorkspaceFs } from "@weaveforge/core";

/**
 * `fs` that calls `onWrite` after each change it makes (a write, a conditional write that
 * happened, a rename, a removal, a new folder). The app uses it to drop the screen data a
 * change made stale, so a list shows a new entry at once instead of after the cache expires.
 */
export function writtenWorkspaceFs(fs: IWorkspaceFs, onWrite: () => void): IWorkspaceFs {
  const after =
    <A extends unknown[]>(change: (...args: A) => Promise<void>) =>
    async (...args: A) => {
      await change(...args);
      onWrite();
    };
  const written: IWorkspaceFs = {
    readFile: (path) => fs.readFile(path),
    readText: (path) => fs.readText(path),
    writeFile: after((path: string, data: Uint8Array | string) => fs.writeFile(path, data)),
    remove: after((path: string, options?: { recursive?: boolean }) => fs.remove(path, options)),
    mkdirp: after((path: string) => fs.mkdirp(path)),
    list: (dir) => fs.list(dir),
    walk: (dir) => fs.walk(dir),
    stat: (path) => fs.stat(path),
    rename: after((from: string, to: string) => fs.rename(from, to)),
  };
  if (fs.writeTextIf) {
    written.writeTextIf = async (path, text, expected) => {
      const wrote = await fs.writeTextIf!(path, text, expected);
      if (wrote) onWrite();
      return wrote;
    };
  }
  return written;
}
