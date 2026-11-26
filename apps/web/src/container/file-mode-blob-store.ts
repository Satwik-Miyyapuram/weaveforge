import type { IBlobFetcher, IBlobStore } from "@weaveforge/core";

/**
 * Files mode blob store. `upload` writes a personal blob to the device (the file store).
 * `uploadShared` is the one route that writes to the server blob store, and only the share
 * path calls it. Reads and removes stay on the personal store: without the fetch methods a
 * FetchingBlobStore over this one asks for a signed URL, gets none, and every image is missing.
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

  fetchBlobs(bucket: string, paths: readonly string[], fallbackContentType?: string): Promise<Map<string, Blob>> {
    return this.personal.fetchBlobs(bucket, paths, fallbackContentType);
  }
}
