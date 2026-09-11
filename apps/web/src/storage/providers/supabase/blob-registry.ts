import type { SupabaseClient } from "@supabase/supabase-js";
import type { BlobObjectRecord, BlobTier, IBlobRegistry, RegisterBlobInput } from "@weaveforge/core";
import { rowToRecord, type BlobRow } from "@/storage/providers/blob-row";
import { rows, run } from "@/backend/providers/supabase/row-access";

/** Postgres `blob_objects` registry via Supabase PostgREST. */
export class SupabaseBlobRegistry implements IBlobRegistry {
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
    }));
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

  async setTier(bucket: string, path: string, tier: BlobTier, sizeBytes?: number): Promise<void> {
    const patch: Record<string, unknown> = { tier };
    if (sizeBytes !== undefined) patch.size_bytes = sizeBytes;
    await run(this.db.from("blob_objects").update(patch).eq("bucket", bucket).eq("path", path));
  }

  async remove(bucket: string, path: string): Promise<void> {
    await run(this.db.from("blob_objects").delete().eq("bucket", bucket).eq("path", path));
  }

  async listHot(): Promise<BlobObjectRecord[]> {
    return (await rows<BlobRow>(this.db.from("blob_objects").select("*").eq("tier", "hot"))).map(rowToRecord);
  }

  async hotBytesTotal(): Promise<number> {
    const { data, error } = await this.db.from("blob_objects").select("size_bytes").eq("tier", "hot");
    if (error) throw error;
    return (data as { size_bytes: number }[]).reduce((n, r) => n + Number(r.size_bytes), 0);
  }
}
