/**
 * Object/blob storage port (paper images, experiment artifacts, vault assets, …).
 * Implementations: Supabase Storage, S3/R2, MinIO — wired in apps/web/src/storage/.
 */
export interface IBlobStore {
  upload(bucket: string, path: string, blob: Blob, contentType?: string): Promise<void>;
  remove(bucket: string, path: string): Promise<void>;
  signedUrls(bucket: string, paths: string[], ttlSeconds: number): Promise<(string | null)[]>;
}

/**
 * A blob store that can also read blobs back.
 *
 * `IBlobStore` only writes and signs URLs, which is all a server needs. The
 * browser also has to hold the bytes — an image in a note is rendered from an
 * object URL, not a signed one — so that half lives here.
 */
export interface IBlobFetcher extends IBlobStore {
  fetchBytes(bucket: string, path: string): Promise<Uint8Array>;
  fetchBlob(bucket: string, path: string, fallbackContentType?: string): Promise<Blob>;
  /** A whole set at once: a grid fetches its images together, and serially is slow enough to look broken. */
  fetchBlobs(
    bucket: string,
    paths: readonly string[],
    fallbackContentType?: string,
  ): Promise<Map<string, Blob>>;
}
