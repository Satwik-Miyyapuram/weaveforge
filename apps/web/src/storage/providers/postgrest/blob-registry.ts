import { run } from "@/backend/providers/postgrest/row-access";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BlobObjectRecord,
  BlobTier,
  IBlobRegistry,
  RegisterBlobInput,
} from "@weaveforge/core";

// --- blob-row ---
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

// --- blob-registry ---
/** Postgres `blob_objects` registry via PostgREST. */
export class PostgrestBlobRegistry implements IBlobRegistry {
  constructor(private readonly db: SupabaseClient) {}

  async get(bucket: string, path: string): Promise<BlobObjectRecord | null> {
    const { data, error } = await this.db
      .from("blob_objects")
      .select("*")
      .eq("bucket", bucket)
      .eq("path", path)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return rowToRecord(data as BlobRow);
  }

  /**
   * The same lookup for a whole batch, in one round trip.
   *
   * `get` in a loop was the read half of an N+1: the signed-urls route mints up
   * to 200 URLs in one request and called `get` once per path. One `in` query
   * answers all of them — the unique key is `(bucket, path)`, so the result set
   * is at most one row per request path.
   *
   * Keyed by `path` because that is what the caller asked with; a path with no
   * row is simply absent from the map, which reads at the call site exactly as
   * `get` returning null did.
   */
  async getMany(bucket: string, paths: readonly string[]): Promise<Map<string, BlobObjectRecord>> {
    const out = new Map<string, BlobObjectRecord>();
    if (paths.length === 0) return out;
    const { data, error } = await this.db
      .from("blob_objects")
      .select("*")
      .eq("bucket", bucket)
      .in("path", [...paths]);
    if (error) throw error;
    for (const row of (data ?? []) as BlobRow[]) {
      const record = rowToRecord(row);
      out.set(record.path, record);
    }
    return out;
  }

  async register(input: RegisterBlobInput): Promise<void> {
    await run(this.db.from("blob_objects").upsert({
      bucket: input.bucket,
      path: input.path,
      tier: input.tier ?? "hot",
      size_bytes: input.sizeBytes,
      priority: input.priority ?? 50,
      // The row's key is a uuid; a path is unique per bucket. Without a target
      // the upsert resolves on the key and a re-register is a 23505.
    }, { onConflict: "bucket,path" }));
  }

  /**
   * Bumped in the database, not read-modify-written here.
   *
   * This used to `get()` the row, add one in JavaScript and write the sum back,
   * which loses an increment whenever two reads of the same blob overlap — and
   * the rows that overlap are the hot ones the count is used to rank. Migration
   * `0125` moves the `+ 1` to where the row lock is; `record_blob_access` also
   * carries the ownership predicate the UPDATE policy used to apply, so a
   * shared viewer's call stays a no-op rather than becoming an error.
   */
  async recordAccess(bucket: string, path: string): Promise<void> {
    const { error } = await this.db.rpc("record_blob_access", {
      p_bucket: bucket,
      p_path: path,
    });
    if (error) throw error;
  }

  /** The same increment for a batch, in one statement (`0125`). */
  async recordAccessMany(bucket: string, paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.db.rpc("record_blob_access_many", {
      p_bucket: bucket,
      p_paths: [...paths],
    });
    if (error) throw error;
  }

  async remove(bucket: string, path: string): Promise<void> {
    await run(this.db.from("blob_objects").delete().eq("bucket", bucket).eq("path", path));
  }
}
