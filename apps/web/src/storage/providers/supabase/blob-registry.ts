import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BlobObjectRecord,
  BlobTier,
  IBlobRegistry,
  RegisterBlobInput,
} from "@thesis/core";

interface BlobRow {
  bucket: string;
  path: string;
  tier: BlobTier;
  size_bytes: number;
  access_count: number;
  last_accessed_at: string | null;
  priority: number;
  created_at: string;
}

function rowToRecord(row: BlobRow): BlobObjectRecord {
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

  async register(input: RegisterBlobInput): Promise<void> {
    const { error } = await this.db.from("blob_objects").upsert({
      bucket: input.bucket,
      path: input.path,
      tier: input.tier ?? "hot",
      size_bytes: input.sizeBytes,
      priority: input.priority ?? 50,
    });
    if (error) throw error;
  }

  async recordAccess(bucket: string, path: string): Promise<void> {
    const existing = await this.get(bucket, path);
    if (!existing) return;
    const { error } = await this.db
      .from("blob_objects")
      .update({
        access_count: existing.accessCount + 1,
        last_accessed_at: new Date().toISOString(),
      })
      .eq("bucket", bucket)
      .eq("path", path);
    if (error) throw error;
  }

  async setTier(bucket: string, path: string, tier: BlobTier, sizeBytes?: number): Promise<void> {
    const patch: Record<string, unknown> = { tier };
    if (sizeBytes !== undefined) patch.size_bytes = sizeBytes;
    const { error } = await this.db.from("blob_objects").update(patch).eq("bucket", bucket).eq("path", path);
    if (error) throw error;
  }

  async remove(bucket: string, path: string): Promise<void> {
    const { error } = await this.db.from("blob_objects").delete().eq("bucket", bucket).eq("path", path);
    if (error) throw error;
  }

  async listHot(): Promise<BlobObjectRecord[]> {
    const { data, error } = await this.db.from("blob_objects").select("*").eq("tier", "hot");
    if (error) throw error;
    return (data as BlobRow[]).map(rowToRecord);
  }

  async hotBytesTotal(): Promise<number> {
    const { data, error } = await this.db.from("blob_objects").select("size_bytes").eq("tier", "hot");
    if (error) throw error;
    return (data as { size_bytes: number }[]).reduce((n, r) => n + Number(r.size_bytes), 0);
  }
}
