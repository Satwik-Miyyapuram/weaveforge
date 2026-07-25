/**
 * Object/blob storage port (paper images, experiment artifacts, vault assets, …).
 * Implementations: Supabase Storage, S3/R2, MinIO — wired in apps/web/src/storage/.
 */
export interface IBlobStore {
  upload(bucket: string, path: string, blob: Blob, contentType?: string): Promise<void>;
  remove(bucket: string, path: string): Promise<void>;
  signedUrls(bucket: string, paths: string[], ttlSeconds: number): Promise<(string | null)[]>;
}

/** Blob store with client-side decrypt for E2EE assets (plan §5.4). */
export interface IEncryptedBlobStore extends IBlobStore {
  fetchBytes(bucket: string, path: string): Promise<Uint8Array>;
  fetchDecrypted(bucket: string, path: string, fallbackContentType?: string): Promise<Blob>;
  fetchDecryptedMany?(
    bucket: string,
    paths: readonly string[],
    fallbackContentType?: string,
  ): Promise<Map<string, Blob>>;
}
