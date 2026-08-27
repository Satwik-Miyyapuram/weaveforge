import type { IBlobFetcher } from "@weaveforge/core";
import type { LocalQuery } from "./pglite-client";

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
 */
export class LocalBlobStore implements IBlobFetcher {
  constructor(private readonly run: LocalQuery) {}

  async upload(bucket: string, path: string, blob: Blob, contentType?: string): Promise<void> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await this.run(
      `insert into local_blobs (bucket, path, content_type, bytes, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (bucket, path) do update
         set content_type = excluded.content_type, bytes = excluded.bytes, updated_at = now()`,
      [bucket, path, contentType || blob.type || "application/octet-stream", toBase64(bytes)],
    );
  }

  async remove(bucket: string, path: string): Promise<void> {
    await this.run("delete from local_blobs where bucket = $1 and path = $2", [bucket, path]);
  }

  async signedUrls(bucket: string, paths: string[], _ttlSeconds: number): Promise<(string | null)[]> {
    const found = await this.read(bucket, paths);
    return paths.map((path) => {
      const row = found.get(path);
      return row ? `data:${row.content_type};base64,${row.bytes}` : null;
    });
  }

  async fetchBytes(bucket: string, path: string): Promise<Uint8Array> {
    const row = (await this.read(bucket, [path])).get(path);
    if (!row) throw new Error(`Nothing stored at ${bucket}/${path} on this computer.`);
    return fromBase64(row.bytes);
  }

  async fetchBlob(bucket: string, path: string, fallbackContentType?: string): Promise<Blob> {
    const row = (await this.read(bucket, [path])).get(path);
    if (!row) throw new Error(`Nothing stored at ${bucket}/${path} on this computer.`);
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
      `select path, content_type, bytes from local_blobs where bucket = $1 and path in (${holes})`,
      [bucket, ...paths],
    )) as StoredBlob[];
    return new Map(rows.map((row) => [row.path, row]));
  }
}

interface StoredBlob {
  path: string;
  content_type: string;
  bytes: string;
}

function blobOf(row: StoredBlob, fallback?: string): Blob {
  // `.slice()` to hand `Blob` an `ArrayBuffer` rather than a possibly shared one.
  return new Blob([fromBase64(row.bytes).slice().buffer as ArrayBuffer], {
    type: row.content_type || fallback || "application/octet-stream",
  });
}

/** Chunked: `String.fromCharCode(...bytes)` on a whole PDF overflows the stack. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let text = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
