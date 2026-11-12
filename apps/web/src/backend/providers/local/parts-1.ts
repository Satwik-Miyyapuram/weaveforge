import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";
import { readyCore } from "@/lib/rust-core";
import { rustRepository } from "../postgrest/rust-repository";
import { FetchingBlobStore } from "@/storage/fetching-blob-store";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BlobNotFoundError,
  errorMessage,
  type IBlobFetcher,
  type IBlobStore,
} from "@weaveforge/core";
import type { LocalQuery } from "./pglite-client";

// --- local-blob-store ---
/**
 * Where attachment bytes go when they are not kept in the table: one file per
 * `(bucket, path)`, named by the shell. `read` answers `null` for no file.
 */
export interface LocalFiles {
  read(bucket: string, path: string): Promise<Uint8Array | null>;
  write(bucket: string, path: string, bytes: Uint8Array): Promise<void>;
  remove(bucket: string, path: string): Promise<void>;
}

/** The shell's offline file commands, when it has them (the Rust shell does, Electron does not). */
export function localFiles(bridge: DesktopBridge | null): LocalFiles | undefined {
  const { readLocalFile, writeLocalFile, removeLocalFile } = bridge ?? {};
  if (!bridge || !readLocalFile || !writeLocalFile || !removeLocalFile) return undefined;
  return {
    read: (bucket, path) => readLocalFile.call(bridge, bucket, path),
    write: (bucket, path, bytes) => writeLocalFile.call(bridge, bucket, path, bytes),
    remove: (bucket, path) => removeLocalFile.call(bridge, bucket, path),
  };
}

/**
 * Attachments on this computer.
 *
 * Storage is the one part of the backend with no local equivalent to point at:
 * it is a service rather than a schema, so there is nothing for the migrations
 * to bring across. The bytes go in a table instead, base64 because the bridge
 * to the shell carries text.
 *
 * `signedUrls` answers with data URLs. A signed URL exists so a browser can
 * fetch bytes it is not allowed to ask the database for; here it is allowed,
 * there is no server to sign anything, and a data URL is the same bytes with
 * no round trip. The trade is that a very large attachment is materialised in
 * the page — acceptable for a copy whose whole library is already on the disk
 * under it, and the reason `fetchBlob` exists for the paths that can take it.
 *
 * With `files` (the Rust shell), the bytes go to a file and the row keeps only
 * the content type, marked `on_disk`. Rows written inline before are still
 * read from the table. An `on_disk` row with no `files`, or whose file is
 * gone, reads as missing.
 */
export class LocalBlobStore implements IBlobFetcher {
  constructor(
    private readonly run: LocalQuery,
    private readonly files?: LocalFiles,
  ) {}

  async upload(bucket: string, path: string, blob: Blob, contentType?: string): Promise<void> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const type = contentType || blob.type || "application/octet-stream";
    // The file first: a row never points at bytes that were not written.
    if (this.files) await this.files.write(bucket, path, bytes);
    await this.run(
      readyCore().localBlobSql("upsertBlob"),
      [bucket, path, type, this.files ? null : readyCore().encodeBase64(bytes), Boolean(this.files)],
    );
  }

  async remove(bucket: string, path: string): Promise<void> {
    const gone = (await this.run(readyCore().localBlobSql("deleteBlobReturningOnDisk"), [
      bucket,
      path,
    ])) as { on_disk: boolean }[];
    if (this.files && gone.some((row) => row.on_disk)) await this.files.remove(bucket, path);
  }

  async signedUrls(bucket: string, paths: string[], _ttlSeconds: number): Promise<(string | null)[]> {
    const found = await this.read(bucket, paths);
    return paths.map((path) => {
      const row = found.get(path);
      return row ? `data:${row.content_type};base64,${readyCore().encodeBase64(row.bytes)}` : null;
    });
  }

  async fetchBytes(bucket: string, path: string): Promise<Uint8Array> {
    const row = (await this.read(bucket, [path])).get(path);
    if (!row) throw new BlobNotFoundError(bucket, path);
    return row.bytes;
  }

  async fetchBlob(bucket: string, path: string, fallbackContentType?: string): Promise<Blob> {
    const row = (await this.read(bucket, [path])).get(path);
    if (!row) throw new BlobNotFoundError(bucket, path);
    return blobOf(row, fallbackContentType);
  }

  async fetchBlobs(
    bucket: string,
    paths: readonly string[],
    fallbackContentType?: string,
  ): Promise<Map<string, Blob>> {
    const found = await this.read(bucket, [...paths]);
    const blobs = new Map<string, Blob>();
    for (const [path, row] of found) blobs.set(path, blobOf(row, fallbackContentType));
    return blobs;
  }

  /** One statement per set, so a grid of images is one call rather than twenty. */
  private async read(bucket: string, paths: string[]): Promise<Map<string, StoredBlob>> {
    if (paths.length === 0) return new Map();
    const rows = (await this.run(readyCore().localBlobReadSql(paths.length), [
      bucket,
      ...paths,
    ])) as BlobRow[];
    const found = await Promise.all(rows.map((row) => this.bytesOf(bucket, row)));
    return new Map(found.filter((b): b is StoredBlob => b !== null).map((b) => [b.path, b]));
  }

  private async bytesOf(bucket: string, row: BlobRow): Promise<StoredBlob | null> {
    if (!row.on_disk) {
      return row.bytes === null ? null : { ...row, bytes: readyCore().decodeBase64(row.bytes) };
    }
    const bytes = this.files ? await this.files.read(bucket, row.path) : null;
    return bytes ? { path: row.path, content_type: row.content_type, bytes } : null;
  }
}

interface BlobRow {
  path: string;
  content_type: string;
  bytes: string | null;
  on_disk: boolean;
}

interface StoredBlob {
  path: string;
  content_type: string;
  bytes: Uint8Array;
}

function blobOf(row: StoredBlob, fallback?: string): Blob {
  // `.slice()` to hand `Blob` an `ArrayBuffer` rather than a possibly shared one.
  return new Blob([row.bytes.slice().buffer as ArrayBuffer], {
    type: row.content_type || fallback || "application/octet-stream",
  });
}

// --- local-first-blob-store ---
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
 * not copied down; PDFs are kept in the workspace folder instead.
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
    const [pending] = (await this.run(readyCore().localBlobSql("selectUploadOp"), [
      bucket,
      path,
    ])) as { op: string }[];
    // Never reached the server: forgetting it is the whole of the removal.
    if (readyCore().localBlobRemovalForgetsUpload(pending?.op)) {
      await this.run(readyCore().localBlobSql("deleteUpload"), [bucket, path]);
      return;
    }
    await this.enqueue(bucket, path, "remove");
    this.kick();
  }

  async signedUrls(bucket: string, paths: string[], ttlSeconds: number): Promise<(string | null)[]> {
    const here = await this.local.signedUrls(bucket, paths, ttlSeconds);
    const unsigned = readyCore().localBlobUnsignedIndices(here);
    if (unsigned.length === 0) return here;
    const missing = unsigned.map((i) => paths[i]!);
    const there = await this.remote.signedUrls(bucket, missing, ttlSeconds).catch((err: unknown) => {
      warn("Could not get attachment links from the server", `${bucket}: ${describeRejection(err)}`);
      return missing.map(() => null);
    });
    return readyCore().localBlobMergeSignedUrls(paths, here, there);
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
    const missing = readyCore().localBlobMissingPaths(paths, [...found.keys()]);
    if (missing.length === 0) return found;
    const fetched = await this.remote.fetchBlobs(bucket, missing, fallbackContentType).catch((err: unknown) => {
      warn("Could not fetch attachments from the server", `${bucket}: ${describeRejection(err)}`);
      return new Map();
    });
    for (const [path, blob] of fetched) found.set(path, blob as Blob);
    return found;
  }

  /** How many attachments are still waiting for the server. */
  async pending(): Promise<number> {
    const [row] = (await this.run(readyCore().localBlobSql("countUploads"), [])) as { n: number }[];
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
    const queue = (await this.run(readyCore().localBlobSql("selectUploadQueue"), [])) as QueuedBlob[];
    for (const item of queue) {
      try {
        if (item.op === "upload") {
          // Gone from this computer since it was queued: nothing left to send.
          // Any other read failure keeps the row for the retry.
          const blob = await this.local
            .fetchBlob(item.bucket, item.path)
            .catch((err: unknown) => {
              if (err instanceof BlobNotFoundError) return null;
              throw err;
            });
          if (blob) await this.remote.upload(item.bucket, item.path, blob, blob.type);
        } else {
          await this.remote.remove(item.bucket, item.path);
        }
        await this.run(readyCore().localBlobSql("deleteUploadVersion"), [
          item.bucket,
          item.path,
          item.version,
        ]);
      } catch (err) {
        await this.run(readyCore().localBlobSql("bumpUploadAttempt"), [
          item.bucket,
          item.path,
          errorMessage(err),
        ]);
        return;
      }
    }
  }

  private async enqueue(bucket: string, path: string, op: "upload" | "remove"): Promise<void> {
    await this.run(readyCore().localBlobSql("enqueueUpload"), [bucket, path, op]);
  }

  private kick(): void {
    void this.flush().catch(warnFlushFailed);
  }
}

interface QueuedBlob {
  bucket: string;
  path: string;
  op: "upload" | "remove";
  version: number;
}

function warn(message: string, detail: string): void {
  logToApp({ level: "warn", source: "attachments", message, detail });
}

/** The queue keeps the item for the next turn; the log says why this one failed. */
function warnFlushFailed(err: unknown): void {
  warn("Sending attachments to the server failed", describeRejection(err));
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
  const flush = () => void store.flush().catch(warnFlushFailed);
  window.addEventListener("online", flush);
  const timer = window.setInterval(flush, BLOB_RETRY_MS);
  flush();
  return () => {
    window.removeEventListener("online", flush);
    window.clearInterval(timer);
  };
}

// --- local-first-experiment-push ---
export const EXPERIMENT_PUSH_MS = 30_000;

/**
 * Sends what the desktop SDK API kept on this computer to the server, so a run
 * logged here shows on the web too: metric points (not in the change feed) and
 * `app://artifacts/` files, which become storage paths in the synced row.
 */
export class ExperimentPush {
  private running: Promise<void> | null = null;

  constructor(
    private readonly run: LocalQuery,
    private readonly server: SupabaseClient,
    private readonly blobs: LocalFirstBlobStore,
    private readonly accountId: string,
    private readonly fetchLocal: (url: string) => Promise<Blob> = fetchBlob,
    private readonly compress: (blob: Blob) => Promise<Blob> = toWebp,
  ) {}

  /** The server queries Rust plans (`crates/wf-core/src/repos/experiment_push.rs`). */
  private server_(): ExperimentPushRepository {
    const repo = rustRepository<ExperimentPushRepository>(
      this.server,
      "experiment_push",
      ["clearReset", "pushBatch", "setArtifacts", "staleArtifactIds"],
      () => ({ userId: this.accountId }),
    );
    // The sender rejects with the raw PostgREST error; keep the database's own message.
    const wrap = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => (...a: A) =>
      f(...a).catch((err: unknown) => {
        throw err instanceof Error ? err : new Error((err as { message?: string } | null)?.message ?? String(err));
      });
    return {
      clearReset: wrap(repo.clearReset),
      pushBatch: wrap(repo.pushBatch),
      setArtifacts: wrap(repo.setArtifacts),
      staleArtifactIds: wrap(repo.staleArtifactIds),
    };
  }

  push(): Promise<void> {
    this.running ??= this.pushAll().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async pushAll(): Promise<void> {
    await this.pushResets();
    await this.pushMetrics();
    await this.pushArtifacts();
    await this.repairServerArtifacts();
  }

  private async pushResets(): Promise<void> {
    const resets = (await this.run(readyCore().localExperimentPushSql("selectResets"), [])) as { experiment_id: string }[];
    const server = this.server_();
    for (const { experiment_id: id } of resets) {
      await server.clearReset(id);
      await this.run(readyCore().localExperimentPushSql("deleteReset"), [id]);
    }
  }

  // Full resolution stays here; the server gets the same thinned curve the web SDK route stores.
  private async pushMetrics(): Promise<void> {
    const series = (await this.run(readyCore().localExperimentPushSql("selectSeries"), [])) as {
      experiment_id: string;
      metric_id: number;
      metric: string;
      pushed: number | null;
    }[];
    const server = this.server_();
    const batch = readyCore().localExperimentBatch();
    for (const s of series) {
      let pushed = s.pushed;
      for (;;) {
        const rows = (await this.run(readyCore().localExperimentPushSql("selectPointsAfter"), [
          s.experiment_id,
          s.metric_id,
          readyCore().localExperimentPushedCursor(pushed ?? undefined),
        ])) as Omit<MetricRow, "experiment_id" | "metric">[];
        if (!rows.length) break;
        // Rust thins the batch to the stored grid. The cursor is written after the
        // server insert; if that write failed, this batch was sent before, so the
        // batch's range is cleared first and a re-send leaves no stray point.
        pushed = await server.pushBatch(s.experiment_id, s.metric, pushed, rows);
        await this.run(readyCore().localExperimentPushSql("upsertPushCursor"), [s.experiment_id, s.metric, pushed]);
        if (rows.length < batch) break;
      }
      // Points that landed while this ran keep the series queued.
      await this.run(readyCore().localExperimentPushSql("deleteDirtyBelowCursor"), [
        s.experiment_id,
        s.metric_id,
        readyCore().localExperimentPushedCursor(pushed ?? undefined),
      ]);
    }
  }

  private async pushArtifacts(): Promise<void> {
    const rows = (await this.run(readyCore().localExperimentPushSql("selectArtifactRows"), [])) as {
      id: string;
      artifacts: unknown;
    }[];
    for (const row of rows) {
      const list = typeof row.artifacts === "string" ? (JSON.parse(row.artifacts) as unknown) : row.artifacts;
      if (!Array.isArray(list)) continue;
      const next: unknown[] = [];
      for (const entry of list) {
        const rest = typeof entry === "string" ? readyCore().localExperimentArtifactRest(entry) : undefined;
        if (!rest) {
          next.push(entry);
          continue;
        }
        try {
          // `{experimentId}/{uuid}/{name}` keeps its uuid, so a re-run is the same path.
          const raw = await this.fetchLocal(entry as string);
          const blob = await this.compress(raw);
          const name = readyCore().localExperimentArtifactStorageName(rest, blob !== raw);
          const path = readyCore().localExperimentArtifactStoragePath(this.accountId, name);
          await this.blobs.upload(readyCore().localExperimentArtifactBucket(), path, blob, blob.type);
          next.push(path);
        } catch (err) {
          // One unreadable file must not hold back the rest; it stays local and is tried next turn.
          logToApp({ level: "warn", source: "experiment-push", message: "Could not push an artifact", detail: `${entry}: ${String(err)}` });
          next.push(entry);
        }
      }
      // Raw local writes skip the outbox, so the server row is set here too.
      await this.server_().setArtifacts(row.id, next);
      await this.run(readyCore().localExperimentPushSql("updateArtifacts"), [row.id, JSON.stringify(next)]);
    }
  }

  // Builds before this fix rewrote only the local row; send those paths up once.
  private async repairServerArtifacts(): Promise<void> {
    const local = (await this.run(readyCore().localExperimentPushSql("selectLocalArtifactsOf"), [
      readyCore().localExperimentAccountArtifactsPattern(this.accountId),
    ])) as { id: string; artifacts: unknown }[];
    if (!local.length) return;
    const server = this.server_();
    const stale = new Set(await server.staleArtifactIds(local.map((r) => r.id)));
    for (const row of local) {
      if (!stale.has(row.id)) continue;
      const artifacts = typeof row.artifacts === "string" ? (JSON.parse(row.artifacts) as unknown) : row.artifacts;
      await server.setArtifacts(row.id, artifacts);
    }
  }
}

/** The server half of the push, as `experiment_push.rs` runs it. */
interface ExperimentPushRepository {
  clearReset(experimentId: string): Promise<void>;
  /** Sends one batch, thinned; resolves to the new cursor (the batch's last step). */
  pushBatch(experimentId: string, metric: string, pushed: number | null, rows: readonly unknown[]): Promise<number>;
  setArtifacts(experimentId: string, artifacts: unknown): Promise<void>;
  staleArtifactIds(ids: readonly string[]): Promise<string[]>;
}

interface MetricRow {
  experiment_id: string;
  metric: string;
  step: number;
  value: number;
  wall_time: string | null;
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.blob();
}

// Server copy of png/jpg goes up as webp; svg and other files stay as they are.
export async function toWebp(blob: Blob): Promise<Blob> {
  if (!readyCore().localExperimentShouldRecompress(blob.type) || typeof OffscreenCanvas === "undefined") return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const webp = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
    return readyCore().localExperimentPreferWebp(webp.type, webp.size, blob.size) ? webp : blob;
  } catch {
    return blob;
  }
}

/** Push on a timer and when the network comes back; failures wait for the next turn. */
export function keepPushing(push: ExperimentPush): () => void {
  if (typeof window === "undefined") return () => undefined;
  const go = () =>
    void push.push().catch((err: unknown) =>
      logToApp({
        level: "warn",
        source: "experiment-push",
        message: "Pushing experiments to the server failed",
        detail: describeRejection(err),
      }),
    );
  window.addEventListener("online", go);
  const timer = window.setInterval(go, EXPERIMENT_PUSH_MS);
  go();
  return () => {
    window.removeEventListener("online", go);
    window.clearInterval(timer);
  };
}
