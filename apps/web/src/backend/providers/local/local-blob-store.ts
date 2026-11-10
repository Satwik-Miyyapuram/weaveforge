import { BlobNotFoundError, type IBlobFetcher } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import type { LocalQuery } from "./pglite-client";

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
      `insert into local_blobs (bucket, path, content_type, bytes, on_disk, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (bucket, path) do update
         set content_type = excluded.content_type, bytes = excluded.bytes,
             on_disk = excluded.on_disk, updated_at = now()`,
      [bucket, path, type, this.files ? null : readyCore().encodeBase64(bytes), Boolean(this.files)],
    );
  }

  async remove(bucket: string, path: string): Promise<void> {
    const gone = (await this.run(
      "delete from local_blobs where bucket = $1 and path = $2 returning on_disk",
      [bucket, path],
    )) as { on_disk: boolean }[];
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
    const holes = paths.map((_, i) => `$${i + 2}`).join(", ");
    const rows = (await this.run(
      `select path, content_type, bytes, on_disk from local_blobs where bucket = $1 and path in (${holes})`,
      [bucket, ...paths],
    )) as BlobRow[];
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

