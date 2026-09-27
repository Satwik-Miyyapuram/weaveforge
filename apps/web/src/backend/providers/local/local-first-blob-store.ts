import type { IBlobFetcher, IBlobStore } from "@weaveforge/core";
import { FetchingBlobStore } from "@/storage/fetching-blob-store";
import { LocalBlobStore } from "./local-blob-store";
import type { LocalQuery } from "./pglite-client";

/**
 * Attachments for a signed-in desktop: this computer first, the server after.
 *
 * A picture inserted into a note or a PDF used to go straight to the server,
 * so with no network — or a server whose storage was misconfigured — the
 * insert failed and nothing appeared. Now the bytes land in `local_blobs`
 * before anything else happens, the insert succeeds, and a queue carries them
 * to the server in the background once it can be reached.
 *
 * Reads look here first and ask the server only for what this computer does
 * not have — a picture another device added, say. What the server returns is
 * not copied down: the offline cache (`offline_blobs`) owns which PDFs a
 * device keeps and how much space they may take.
 */
export class LocalFirstBlobStore implements IBlobFetcher {
  private readonly local: LocalBlobStore;
  private readonly remote: IBlobFetcher;
  private flushing: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly run: LocalQuery,
    remote: IBlobStore,
    private readonly isOnline: () => boolean = defaultOnline,
  ) {
    this.local = new LocalBlobStore(run);
    this.remote = new FetchingBlobStore(remote);
  }

  async upload(bucket: string, path: string, blob: Blob, contentType?: string): Promise<void> {
    await this.local.upload(bucket, path, blob, contentType);
    await this.enqueue(bucket, path, "upload");
    this.kick();
  }

  async remove(bucket: string, path: string): Promise<void> {
    await this.local.remove(bucket, path);
    const [pending] = (await this.run(
      "select op from local_blob_uploads where bucket = $1 and path = $2",
      [bucket, path],
    )) as { op: string }[];
    if (pending?.op === "upload") {
      // Never reached the server: forgetting it is the whole of the removal.
      await this.run("delete from local_blob_uploads where bucket = $1 and path = $2", [bucket, path]);
      return;
    }
    await this.enqueue(bucket, path, "remove");
    this.kick();
  }

  async signedUrls(bucket: string, paths: string[], ttlSeconds: number): Promise<(string | null)[]> {
    const here = await this.local.signedUrls(bucket, paths, ttlSeconds);
    const missing = paths.filter((_, i) => here[i] === null);
    if (missing.length === 0) return here;
    const there = await this.remote.signedUrls(bucket, missing, ttlSeconds).catch(() => missing.map(() => null));
    const byPath = new Map(missing.map((path, i) => [path, there[i] ?? null]));
    return paths.map((path, i) => here[i] ?? byPath.get(path) ?? null);
  }

  async fetchBytes(bucket: string, path: string): Promise<Uint8Array> {
    try {
      return await this.local.fetchBytes(bucket, path);
    } catch {
      return this.remote.fetchBytes(bucket, path);
    }
  }

  async fetchBlob(bucket: string, path: string, fallbackContentType?: string): Promise<Blob> {
    try {
      return await this.local.fetchBlob(bucket, path, fallbackContentType);
    } catch {
      return this.remote.fetchBlob(bucket, path, fallbackContentType);
    }
  }

  async fetchBlobs(
    bucket: string,
    paths: readonly string[],
    fallbackContentType?: string,
  ): Promise<Map<string, Blob>> {
    const found = await this.local.fetchBlobs(bucket, paths, fallbackContentType);
    const missing = paths.filter((path) => !found.has(path));
    if (missing.length === 0) return found;
    const fetched = await this.remote.fetchBlobs(bucket, missing, fallbackContentType).catch(() => new Map());
    for (const [path, blob] of fetched) found.set(path, blob as Blob);
    return found;
  }

  /** How many attachments are still waiting for the server. */
  async pending(): Promise<number> {
    const [row] = (await this.run("select count(*)::int as n from local_blob_uploads", [])) as { n: number }[];
    return Number(row?.n ?? 0);
  }

  /**
   * Send what is queued, oldest first, stopping at the first failure: when the
   * server refuses one it will refuse the next for the same reason, and the
   * order is kept for the retry.
   */
  flush(): Promise<void> {
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = this.drain().finally(() => {
      this.flushing = null;
      if (this.again) {
        this.again = false;
        this.kick();
      }
    });
    return this.flushing;
  }

  private async drain(): Promise<void> {
    if (!this.isOnline()) return;
    const queue = (await this.run(
      "select bucket, path, op, version from local_blob_uploads order by queued_at",
      [],
    )) as QueuedBlob[];
    for (const item of queue) {
      try {
        if (item.op === "upload") {
          const blob = await this.local.fetchBlob(item.bucket, item.path).catch(() => null);
          // Gone from this computer since it was queued: nothing left to send.
          if (blob) await this.remote.upload(item.bucket, item.path, blob, blob.type);
        } else {
          await this.remote.remove(item.bucket, item.path);
        }
        await this.run(
          "delete from local_blob_uploads where bucket = $1 and path = $2 and version = $3",
          [item.bucket, item.path, item.version],
        );
      } catch (err) {
        await this.run(
          "update local_blob_uploads set attempts = attempts + 1, last_error = $3 where bucket = $1 and path = $2",
          [item.bucket, item.path, err instanceof Error ? err.message : String(err)],
        );
        return;
      }
    }
  }

  private async enqueue(bucket: string, path: string, op: "upload" | "remove"): Promise<void> {
    await this.run(
      `insert into local_blob_uploads (bucket, path, op, attempts, last_error, queued_at)
       values ($1, $2, $3, 0, null, now())
       on conflict (bucket, path) do update
         set op = excluded.op, version = local_blob_uploads.version + 1, attempts = 0, last_error = null, queued_at = now()`,
      [bucket, path, op],
    );
  }

  private kick(): void {
    void this.flush().catch(() => undefined);
  }
}

interface QueuedBlob {
  bucket: string;
  path: string;
  op: "upload" | "remove";
  version: number;
}

function defaultOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** How often the queue is retried while the app is open. */
export const BLOB_RETRY_MS = 60_000;

/**
 * Retry the queue when the network comes back, and on a slow timer for the
 * failures that are not about the network (a lapsed session, a server error).
 */
export function keepFlushing(store: LocalFirstBlobStore): () => void {
  if (typeof window === "undefined") return () => undefined;
  const flush = () => void store.flush().catch(() => undefined);
  window.addEventListener("online", flush);
  const timer = window.setInterval(flush, BLOB_RETRY_MS);
  flush();
  return () => {
    window.removeEventListener("online", flush);
    window.clearInterval(timer);
  };
}
