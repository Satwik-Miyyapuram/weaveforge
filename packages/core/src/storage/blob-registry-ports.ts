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
  setTier(bucket: string, path: string, tier: BlobTier, sizeBytes?: number): Promise<void>;
  remove(bucket: string, path: string): Promise<void>;
  /** Hot-tier rows for tier-off job (caller sorts by eviction score). */
  listHot(): Promise<BlobObjectRecord[]>;
  hotBytesTotal(): Promise<number>;
}
