import { isLocalMode } from "@/backend/providers/local/local-identity";
import { LocalRunner } from "@/backend/providers/local/local-runner";
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
  const head = JSON.stringify({ model: value.model, dimensions: value.dimensions, ids: value.ids, revision: value.revision });
  return `${toBase64(new TextEncoder().encode(head))}.${toBase64(new Uint8Array(value.vectors))}`;
}

function unpack(packed: string): StoredVectors | null {
  const split = packed.indexOf(".");
  if (split < 0) return null;
  try {
    const head = JSON.parse(new TextDecoder().decode(fromBase64(packed.slice(0, split)))) as Omit<
      StoredVectors,
      "vectors"
    >;
    const bytes = fromBase64(packed.slice(split + 1));
    const vectors = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(vectors).set(bytes);
    return { ...head, vectors };
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // In chunks: `apply` on a megabyte-long array overflows the argument stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let chosen: VectorStore | null = null;

/**
 * The store this copy should use. Decided once: the backend is wired at
 * startup and cannot change without a reload.
 */
export function vectorStore(): VectorStore {
  chosen ??= isLocalMode() ? localStore() : idbStore;
  return chosen;
}
