// --- blob-ports ---
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
 * The blob is not stored there: the one read failure that means "nothing to
 * show" rather than "could not look".
 *
 * A reader that treats every failure as missing turns a network or decrypt
 * error into an empty value, and the caller's next save then writes over what
 * is really stored. So `fetchBytes` throws this only when the store answered
 * that the blob is absent, and anything else for a read that went wrong.
 */
export class BlobNotFoundError extends Error {
  constructor(bucket: string, path: string) {
    super(`Blob not found: ${bucket}/${path}`);
    this.name = "BlobNotFoundError";
  }
}

/**
 * A blob store that can also read blobs back.
 *
 * `IBlobStore` only writes and signs URLs, which is all a server needs. The
 * browser also has to hold the bytes — an image in a note is rendered from an
 * object URL, not a signed one — so that half lives here.
 */
export interface IBlobFetcher extends IBlobStore {
  /** Throws {@link BlobNotFoundError} when the blob is not stored, any other error when the read failed. */
  fetchBytes(bucket: string, path: string): Promise<Uint8Array>;
  fetchBlob(bucket: string, path: string, fallbackContentType?: string): Promise<Blob>;
  /** A whole set at once: a grid fetches its images together, and serially is slow enough to look broken. */
  fetchBlobs(
    bucket: string,
    paths: readonly string[],
    fallbackContentType?: string,
  ): Promise<Map<string, Blob>>;
}

// --- blob-registry-ports ---
/** Hot (R2) or cold (OCI MinIO) storage tier. */
export type BlobTier = "hot" | "cold";

/** Registry row for a stored object (Postgres `blob_objects`). */
export interface BlobObjectRecord {
  bucket: string;
  path: string;
  tier: BlobTier;
  sizeBytes: number;
  accessCount: number;
  lastAccessedAt: Date | null;
  /** 0 = tier off first, 100 = keep hot longest. */
  priority: number;
  createdAt: Date;
}

export interface RegisterBlobInput {
  bucket: string;
  path: string;
  tier?: BlobTier;
  sizeBytes: number;
  priority?: number;
}

/** Tracks blob location, access stats, and tier for hot/cold routing. */
export interface IBlobRegistry {
  get(bucket: string, path: string): Promise<BlobObjectRecord | null>;
  register(input: RegisterBlobInput): Promise<void>;
  recordAccess(bucket: string, path: string): Promise<void>;
  remove(bucket: string, path: string): Promise<void>;
}
