import { isLocalMode } from "@/backend/providers/local/local-identity";
import { LocalRunner } from "@/backend/providers/local/local-runner";
import { decodeBase64, encodeBase64 } from "@/lib/bytea";
import { WORKSPACE_META_DIR } from "@weaveforge/core";
import { activeWorkspaceFs } from "@/features/workspace/application/workspace-folder";
import { idbClearVectors, idbGetVectors, idbSetVectors, type StoredVectors } from "./vector-store-idb";

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
 */
function localStore(): VectorStore {
  const runner = new LocalRunner();
  const run = (sql: string, params: unknown[]) => runner.query(sql, params as never[]);

  return {
    async get(projectId) {
      try {
        const rows = (await run("select bytes from local_blobs where bucket = $1 and path = $2", [
          BUCKET,
          key(projectId),
        ])) as { bytes?: string }[];
        const bytes = rows[0]?.bytes;
        return bytes ? unpack(bytes) : null;
      } catch {
        // A copy whose local database is not there yet has no stored vectors,
        // which is the same answer as a copy that never built any.
        return null;
      }
    },
    async set(projectId, value) {
      try {
        await run(
          `insert into local_blobs (bucket, path, content_type, bytes, updated_at)
           values ($1, $2, $3, $4, now())
           on conflict (bucket, path) do update
             set bytes = excluded.bytes, updated_at = now()`,
          [BUCKET, key(projectId), "application/octet-stream", pack(value)],
        );
      } catch {
        /* best-effort: losing this costs a re-embed, never a result */
      }
    },
    async clear() {
      try {
        await run("delete from local_blobs where bucket = $1", [BUCKET]);
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * One JSON head and one buffer, base64 in a single string.
 *
 * Kept together because they are only ever read together: a set of ids with no
 * vectors, or vectors with no ids, is not half an index but none of one.
 */
function pack(value: StoredVectors): string {
  const head = JSON.stringify({ model: value.model, dimensions: value.dimensions, ids: value.ids, revision: value.revision, hashes: value.hashes });
  return `${encodeBase64(new TextEncoder().encode(head))}.${encodeBase64(new Uint8Array(value.vectors))}`;
}

function unpack(packed: string): StoredVectors | null {
  const split = packed.indexOf(".");
  if (split < 0) return null;
  try {
    const head = JSON.parse(new TextDecoder().decode(decodeBase64(packed.slice(0, split)))) as Omit<
      StoredVectors,
      "vectors"
    >;
    const bytes = decodeBase64(packed.slice(split + 1));
    const vectors = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(vectors).set(bytes);
    return { ...head, vectors };
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
    } catch {
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
  const head = new TextEncoder().encode(
    JSON.stringify({ model: value.model, dimensions: value.dimensions, ids: value.ids, revision: value.revision, hashes: value.hashes }),
  );
  const out = new Uint8Array(4 + head.byteLength + value.vectors.byteLength);
  new DataView(out.buffer).setUint32(0, head.byteLength, true);
  out.set(head, 4);
  out.set(new Uint8Array(value.vectors), 4 + head.byteLength);
  return out;
}

export function unpackBinary(bytes: Uint8Array): StoredVectors | null {
  try {
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
    const head = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length))) as Omit<StoredVectors, "vectors">;
    const vectors = bytes.slice(4 + length).buffer;
    if (vectors.byteLength !== head.ids.length * head.dimensions * 4) return null;
    return { ...head, vectors };
  } catch {
    return null;
  }
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
