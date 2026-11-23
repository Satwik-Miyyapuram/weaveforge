import { isLocalMode } from "@/features/auth/infrastructure/no-account-mode";

import { activeWorkspaceFs } from "@/features/workspace/application/workspace-folder";
import { idbClearVectors, idbGetVectors, idbSetVectors, type StoredVectors } from "./parts-3";
import { warnOnce } from "@/lib/error-report/parts";
import { readyCore } from "@/lib/rust-core";

/**
 * Where a corpus's vectors are kept between sessions.
 *
 * Two answers. In a browser it is IndexedDB, which is the only thing there. In a
 * desktop copy with no account it is the workspace folder, which survives the
 * cache clear that IndexedDB does not; with no folder there is nothing durable
 * to keep, so no vectors are kept at all in that case.
 *
 * The vectors are worth this: a corpus is minutes of arithmetic, and losing
 * them costs the reader that time again for no visible reason.
 */
export interface VectorStore {
  get(projectId: string | null): Promise<StoredVectors | null>;
  set(projectId: string | null, value: StoredVectors): Promise<void>;
  clear(): Promise<void>;
}

const idbStore: VectorStore = {
  get: idbGetVectors,
  set: idbSetVectors,
  clear: idbClearVectors,
};

/**
 * The no-account copy with no workspace folder: it keeps no vectors. Reads find
 * nothing and writes go nowhere. Vectors are a derived cache, not user data, so
 * losing them costs a re-embed, never a result.
 */
export const noStore: VectorStore = {
  async get() {
    return null;
  },
  async set() {},
  async clear() {},
};


/** Where the vectors sit inside a connected workspace folder. */
export function folderCacheDir(): string {
  return readyCore().vectorFolderCacheDir();
}
const folderPath = (projectId: string | null) => readyCore().vectorFolderPath(projectId ?? undefined);

/**
 * A copy in the workspace folder, beside the notes the vectors describe.
 *
 * The folder is what the reader thinks of as their workspace: it survives a
 * reinstall, a cleared cache and a sign-out, and moving it to another machine
 * should not cost a from-scratch embed. It is a cache, not content, so the
 * directory carries a `.gitignore` of its own — versioning the folder must not
 * commit ten megabytes of floats on every edit — and the folder watcher and the
 * mirror both leave it alone.
 *
 * Binary rather than the base64 the database row needs: a length-prefixed
 * JSON head, then the raw vectors.
 */
const folderStore = {
  async get(projectId: string | null): Promise<StoredVectors | null> {
    const fs = activeWorkspaceFs();
    if (!fs) return null;
    try {
      if (!(await fs.stat(folderPath(projectId)))) return null;
      return readyCore().unpackVectors(await fs.readFile(folderPath(projectId)));
    } catch {
      return null;
    }
  },
  async set(projectId: string | null, value: StoredVectors): Promise<void> {
    const fs = activeWorkspaceFs();
    if (!fs) return;
    try {
      const dir = folderCacheDir();
      await fs.mkdirp(dir);
      if (!(await fs.stat(`${dir}/.gitignore`))) {
        await fs.writeFile(`${dir}/.gitignore`, "*\n");
      }
      // The shell writes beside the file and renames it into place, so a
      // kill mid-write leaves the previous cache whole.
      await fs.writeFile(folderPath(projectId), packBinary(value));
    } catch (err) {
      warnOnce("search", "Search vectors were not saved to the workspace folder.", err);
      /* best-effort, like every other copy */
    }
  },
  async clear(): Promise<void> {
    const fs = activeWorkspaceFs();
    if (!fs) return;
    try {
      for (const entry of await fs.list(folderCacheDir())) {
        if (entry.kind === "file" && readyCore().isVectorCacheFile(entry.path)) await fs.remove(entry.path);
      }
    } catch {
      /* nothing there */
    }
  },
};

export function packBinary(value: StoredVectors): Uint8Array {
  return readyCore().packVectors(
    { model: value.model, dimensions: value.dimensions, revision: value.revision, hashes: value.hashes },
    value.bytes,
  );
}

let chosen: VectorStore | null = null;

/**
 * The store this copy should use: the workspace folder first when one is
 * connected, then the copy's own store. Both are written, so a folder that is
 * disconnected later still leaves a warm cache behind, and a folder carried to
 * another machine arrives with its vectors.
 */
export function vectorStore(): VectorStore {
  if (!chosen) {
    const own = isLocalMode() && !activeWorkspaceFs() ? noStore : idbStore;
    chosen = {
      async get(projectId) {
        return (await folderStore.get(projectId)) ?? (await own.get(projectId));
      },
      async set(projectId, value) {
        await Promise.all([folderStore.set(projectId, value), own.set(projectId, value)]);
      },
      async clear() {
        await Promise.all([folderStore.clear(), own.clear()]);
      },
    };
  }
  return chosen;
}
