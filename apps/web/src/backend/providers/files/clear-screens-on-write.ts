import type { IWorkspaceFs } from "@weaveforge/core";
import { clearAllScreenCaches } from "@/lib/cache/parts-2";

/**
 * The folder with every write clearing the cached screens. File repositories are not
 * wrapped in `cacheRepo`, so nothing else tells a screen its payload went stale: its
 * next reload would repaint the old list and skip the load while that list is fresh.
 */
export function clearScreensOnWrite(fs: IWorkspaceFs, onWrite: () => void = clearAllScreenCaches): IWorkspaceFs {
  const after = async <T>(write: Promise<T>): Promise<T> => {
    try {
      return await write;
    } finally {
      // A failed or refused write may have changed the file too, or found it changed.
      onWrite();
    }
  };
  const inner = fs;
  return {
    readFile: (path) => inner.readFile(path),
    readText: (path) => inner.readText(path),
    writeFile: (path, data) => after(inner.writeFile(path, data)),
    // Read at call time: the no-account folder offers it only once a folder is open.
    get writeTextIf() {
      const write = inner.writeTextIf?.bind(inner);
      return write && ((path: string, text: string, expected: string | null) => after(write(path, text, expected)));
    },
    remove: (path, options) => after(inner.remove(path, options)),
    mkdirp: (path) => inner.mkdirp(path),
    list: (dir) => inner.list(dir),
    walk: (dir) => inner.walk(dir),
    stat: (path) => inner.stat(path),
    rename: (from, to) => after(inner.rename(from, to)),
  };
}
