import type { IBlobFetcher, IBlobStore } from "@weaveforge/core";

/**
 * Files mode blob store. `upload` writes a personal blob to the device (the file store).
 * `uploadShared` is the one route meant to write to the server blob store; no caller uses it
 * yet and no server bucket is allowlisted (ORG_SERVER_BUCKETS). Reads and removes stay on the
 * personal store, which reads its own bytes: a device file has no signed url.
 */
export class FileModeBlobStore implements IBlobFetcher {
  constructor(
    private readonly personal: IBlobFetcher,
    private readonly server: IBlobStore,
  ) {}

  upload(bucket: string, path: string, blob: Blob, contentType?: string): Promise<void> {
    return this.personal.upload(bucket, path, blob, contentType);
  }

  uploadShared(bucket: string, path: string, blob: Blob, contentType?: string): Promise<void> {
    return this.server.upload(bucket, path, blob, contentType);
  }

  remove(bucket: string, path: string): Promise<void> {
    return this.personal.remove(bucket, path);
  }

  signedUrls(bucket: string, paths: string[], ttlSeconds: number): Promise<(string | null)[]> {
    return this.personal.signedUrls(bucket, paths, ttlSeconds);
  }

  fetchBytes(bucket: string, path: string): Promise<Uint8Array> {
    return this.personal.fetchBytes(bucket, path);
  }

  fetchBlob(bucket: string, path: string, fallbackContentType?: string): Promise<Blob> {
    return this.personal.fetchBlob(bucket, path, fallbackContentType);
  }

  /** A missing or unreadable file is left out of the map, as FetchingBlobStore does: one bad image does not fail the batch. */
  async fetchBlobs(bucket: string, paths: readonly string[], fallbackContentType?: string): Promise<Map<string, Blob>> {
    const out = new Map<string, Blob>();
    for (const path of paths) {
      try {
        out.set(path, await this.personal.fetchBlob(bucket, path, fallbackContentType));
      } catch {
        // skipped, like a broken asset on the signed-url path
      }
    }
    return out;
  }
}
