/**
 * The blob buckets. The access rules the `/api/blobs/*` routes enforce — owned
 * paths, shared resources, view tokens — live in the Rust relay
 * (wf-core `storage::blob_access`); uploads, shares and the account purge read
 * this list.
 */

/** Every bucket a user's blobs live in. */
export const BLOB_STORAGE_BUCKETS = [
  "paper-images",
  "experiment-artifacts",
  "vault-assets",
  "report-images",
  "log-images",
] as const;

export type BlobStorageBucket = (typeof BLOB_STORAGE_BUCKETS)[number];
