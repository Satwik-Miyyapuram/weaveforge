import { rustRepository } from "@/backend/providers/postgrest/rust-repository";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BlobObjectRecord, BlobTier, IBlobRegistry, RegisterBlobInput } from "@weaveforge/core";

/** A registry record as Rust sends it: timestamps as ISO-8601 text. */
type BlobObjectJson = Omit<BlobObjectRecord, "lastAccessedAt" | "createdAt"> & {
  lastAccessedAt: string | null;
  createdAt: string;
};

/** The `blob_objects` queries, planned by Rust (`crates/wf-core/src/repos/blob_objects.rs`). */
interface BlobObjectStore {
  get(bucket: string, path: string): Promise<BlobObjectJson | null>;
  getMany(bucket: string, paths: readonly string[]): Promise<BlobObjectJson[]>;
  register(input: RegisterBlobInput): Promise<void>;
  recordAccess(bucket: string, path: string): Promise<void>;
  recordAccessMany(bucket: string, paths: readonly string[]): Promise<void>;
  remove(bucket: string, path: string): Promise<void>;
  listForUser(userId: string): Promise<{ bucket: string; path: string }[]>;
  deleteForUser(userId: string): Promise<void>;
}

function toRecord(row: BlobObjectJson): BlobObjectRecord {
  return {
    ...row,
    tier: row.tier as BlobTier,
    lastAccessedAt: row.lastAccessedAt ? new Date(row.lastAccessedAt) : null,
    createdAt: new Date(row.createdAt),
  };
}

/** Postgres `blob_objects` registry via PostgREST. */
export class PostgrestBlobRegistry implements IBlobRegistry {
  private readonly store: BlobObjectStore;

  constructor(db: SupabaseClient) {
    this.store = rustRepository<BlobObjectStore>(db, "blob_objects", [
      "get",
      "getMany",
      "register",
      "recordAccess",
      "recordAccessMany",
      "remove",
      "listForUser",
      "deleteForUser",
    ]);
  }

  async get(bucket: string, path: string): Promise<BlobObjectRecord | null> {
    const row = await this.store.get(bucket, path);
    return row && toRecord(row);
  }

  /**
   * The same lookup for a whole batch, in one round trip (the signed-urls route
   * mints up to 200 URLs at once). Keyed by `path`; a path with no row is absent.
   */
  async getMany(bucket: string, paths: readonly string[]): Promise<Map<string, BlobObjectRecord>> {
    const rows = await this.store.getMany(bucket, paths);
    return new Map(rows.map((row) => [row.path, toRecord(row)]));
  }

  /** Upsert on `(bucket, path)`, so a re-register updates the row instead of a 23505. */
  register(input: RegisterBlobInput): Promise<void> {
    return this.store.register(input);
  }

  /** The `+ 1` happens in the database (`record_blob_access`, 0125), under the row lock. */
  recordAccess(bucket: string, path: string): Promise<void> {
    return this.store.recordAccess(bucket, path);
  }

  /** The same increment for a batch, in one statement (`0125`). */
  recordAccessMany(bucket: string, paths: readonly string[]): Promise<void> {
    return this.store.recordAccessMany(bucket, paths);
  }

  remove(bucket: string, path: string): Promise<void> {
    return this.store.remove(bucket, path);
  }

  /** The bucket and path of each object `userId` owns (service role). */
  listForUser(userId: string): Promise<{ bucket: string; path: string }[]> {
    return this.store.listForUser(userId);
  }

  /** Removes every registry row `userId` owns (service role). */
  deleteForUser(userId: string): Promise<void> {
    return this.store.deleteForUser(userId);
  }
}
