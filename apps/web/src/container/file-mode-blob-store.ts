import type { IBlobStore } from "@weaveforge/core";

/**
 * Files mode blob store. `upload` writes a personal blob to the device (the file store).
 * `uploadShared` is the one route that writes to the server blob store, and only the share
 * path calls it. Reads and removes stay on the personal store.
 */
export class FileModeBlobStore implements IBlobStore {
  constructor(
    private readonly personal: IBlobStore,
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
}
