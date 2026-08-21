import type { BlobObjectRecord, BlobTier } from "@weaveforge/core";

/**
 * One `blob_objects` row, and the one way to read it.
 *
 * Both registries — the pooled Postgres one used by the server routes and the
 * PostgREST one used by the browser — return this same row and mapped it
 * identically, so the shape and the mapping live here rather than twice.
 */
export interface BlobRow {
  bucket: string;
  path: string;
  tier: BlobTier;
  size_bytes: number;
  access_count: number;
  last_accessed_at: string | null;
  priority: number;
  created_at: string;
}

export function rowToRecord(row: BlobRow): BlobObjectRecord {
  return {
    bucket: row.bucket,
    path: row.path,
    tier: row.tier,
    sizeBytes: Number(row.size_bytes),
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at) : null,
    priority: row.priority,
    createdAt: new Date(row.created_at),
  };
}
