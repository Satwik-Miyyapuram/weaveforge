import { isLocalMode } from "@/backend/providers/local/local-identity";
import { LocalRunner } from "@/backend/providers/local/local-runner";
import { localFiles, type LocalFiles } from "@/backend/providers/local/local-blob-store";
import { desktop } from "@/lib/desktop/desktop-bridge";

import { WORKSPACE_META_DIR } from "@weaveforge/core";
import { activeWorkspaceFs } from "@/features/workspace/application/workspace-folder";
import { idbClearVectors, idbGetVectors, idbSetVectors, type StoredVectors } from "./vector-store-idb";
import { warnOnce } from "@/lib/error-report/warn-once";
import { readyCore } from "@/lib/rust-core";

/**
 * Where a corpus's vectors are kept between sessions.
 *
 * Two answers, because the two copies of the app have different ideas of what
 * durable means. In a browser it is IndexedDB, which is the only thing there;
 * on a desktop copy with no account it is the local database, which lives in
 * the workspace folder and survives the cache clear that IndexedDB does not.
 *
 * The vectors are worth this: a corpus is minutes of arithmetic, and losing
 * them costs the reader that time again for no visible reason.
 */
export interface VectorStore {
  get(projectId: string | null): Promise<StoredVectors | null>;
  set(projectId: string | null, value: StoredVectors): Promise<void>;
  clear(): Promise<void>;
}

const BUCKET = "vectors";
const key = (projectId: string | null) => projectId ?? "-";

const idbStore: VectorStore = {
  get: idbGetVectors,
  set: idbSetVectors,
  clear: idbClearVectors,
};

/**
 * The local database, through the same table attachments use.
 *
 * `local_blobs` already carries bytes as base64 for exactly this reason — the
 * bridge to the shell is text — so a second table for the same problem would
 * be a second thing to migrate. The ids and the model live in the row's JSON
 * head, the vectors in its buffer, packed together so one read restores both.
 *
 * With the shell's offline files (the Rust shell), the vectors go to a file in
 * the binary format and the row is only the index `clear` walks. Rows written
 * inline before are still read.
 */
function localStore(): VectorStore {
  const runner = new LocalRunner();
  return localVectorStore((sql, params) => runner.query(sql, params as never[]), localFiles(desktop()));
}

/** The local-database store over any query function; exported for tests. */
export function localVectorStore(run: (sql: string, params: unknown[]) => Promise<unknown[]>, files?: LocalFiles): VectorStore {
  return {
    async get(projectId) {
      try {
        const rows = (await run("select bytes, on_disk from local_blobs where bucket = $1 and path = $2", [
          BUCKET,
          key(projectId),
        ])) as { bytes?: string | null; on_disk?: boolean }[];
        const row = rows[0];
        if (row?.on_disk) {
          const bytes = files ? await files.read(BUCKET, key(projectId)) : null;
          return bytes ? unpackBinary(bytes) : null;
        }
        return row?.bytes ? unpack(row.bytes) : null;
      } catch {
        // A copy whose local database is not there yet has no stored vectors,
        // which is the same answer as a copy that never built any.
        return null;
      }
    },
    async set(projectId, value) {
      try {
        if (files) await files.write(BUCKET, key(projectId), packBinary(value));
        await run(
          `insert into local_blobs (bucket, path, content_type, bytes, on_disk, updated_at)
           values ($1, $2, $3, $4, $5, now())
           on conflict (bucket, path) do update
             set bytes = excluded.bytes, on_disk = excluded.on_disk, updated_at = now()`,
          [BUCKET, key(projectId), "application/octet-stream", files ? null : pack(value), Boolean(files)],
        );
      } catch (err) {
        warnOnce("search", "Search vectors were not saved to the local database.", err);
        /* best-effort: losing this costs a re-embed, never a result */
      }
    },
    async clear() {
      try {
        const gone = (await run("delete from local_blobs where bucket = $1 returning path, on_disk", [BUCKET])) as {
          path: string;
          on_disk: boolean;
        }[];
        if (files) await Promise.all(gone.filter((r) => r.on_disk).map((r) => files.remove(BUCKET, r.path)));
      } catch (err) {
        warnOnce("search", "Search vectors were not cleared from the local database.", err);
        /* ignore */
      }
    },
  };
}

/**
 * One JSON head and one buffer, base64 in a single string.
 *
 * Kept together because they are only ever read together: the index blob carries
 * its own ids and widths, so the head holds only what describes the blob.
 */
/** The fields both formats store ahead of the blob, as JSON. */
function headJson(value: StoredVectors): string {
  return JSON.stringify({ model: value.model, dimensions: value.dimensions, revision: value.revision, hashes: value.hashes });
}

function pack(value: StoredVectors): string {
  const head = headJson(value);
  return `${readyCore().encodeBase64(new TextEncoder().encode(head))}.${readyCore().encodeBase64(value.bytes)}`;
}

function unpack(packed: string): StoredVectors | null {
  const split = packed.indexOf(".");
  if (split < 0) return null;
  try {
    const head = JSON.parse(new TextDecoder().decode(readyCore().decodeBase64(packed.slice(0, split)))) as Omit<
      StoredVectors,
      "bytes"
    >;
    return { ...head, bytes: readyCore().decodeBase64(packed.slice(split + 1)) };
  } catch {
    return null;
  }
}


/** Where the vectors sit inside a connected workspace folder. */
export const FOLDER_CACHE_DIR = `${WORKSPACE_META_DIR}/cache`;
const folderPath = (projectId: string | null) => `${FOLDER_CACHE_DIR}/vectors-${key(projectId)}.bin`;

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
      return unpackBinary(await fs.readFile(folderPath(projectId)));
    } catch {
      return null;
    }
  },
  async set(projectId: string | null, value: StoredVectors): Promise<void> {
    const fs = activeWorkspaceFs();
    if (!fs) return;
    try {
      await fs.mkdirp(FOLDER_CACHE_DIR);
      if (!(await fs.stat(`${FOLDER_CACHE_DIR}/.gitignore`))) {
        await fs.writeFile(`${FOLDER_CACHE_DIR}/.gitignore`, "*\n");
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
      for (const entry of await fs.list(FOLDER_CACHE_DIR)) {
        if (entry.kind === "file" && /\/vectors-[^/]*\.bin$/.test(`/${entry.path}`)) await fs.remove(entry.path);
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

export function unpackBinary(bytes: Uint8Array): StoredVectors | null {
  // The blob is validated where it is loaded (`vectorIndexFromBytes`), which rejects a short or torn one.
  return readyCore().unpackVectors(bytes);
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
    const own = isLocalMode() ? localStore() : idbStore;
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
