/**
 * Blob access constants (Rust `storage::blob_access`), re-exported from index.ts.
 */
import {
  blobStorageBuckets as rawBlobStorageBuckets,
  maxSignedUrlPaths as rawMaxSignedUrlPaths,
} from "../pkg/wf_wasm.js";

/** Most paths one signed-url request may ask for. The relay enforces the same cap. */
export function maxSignedUrlPaths(): number {
  return rawMaxSignedUrlPaths();
}

/** A bucket a user's blobs live in. The list is Rust `blob_access::BLOB_STORAGE_BUCKETS`. */
export type BlobStorageBucket =
  | "paper-images"
  | "experiment-artifacts"
  | "vault-assets"
  | "report-images"
  | "log-images";

/** Every bucket a user's blobs live in (the account purge sweeps each one). */
export function blobStorageBuckets(): BlobStorageBucket[] {
  return rawBlobStorageBuckets() as BlobStorageBucket[];
}
