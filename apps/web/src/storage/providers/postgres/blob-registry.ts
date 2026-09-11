import type { BlobObjectRecord, BlobTier, IBlobRegistry, RegisterBlobInput } from "@weaveforge/core";
import { rowToRecord, type BlobRow } from "@/storage/providers/blob-row";
import type { PgRunner } from "@/backend/providers/postgres/pg-runner";

/** Postgres `blob_objects` registry via pg pool + RLS session. */
export class PostgresBlobRegistry implements IBlobRegistry {
  constructor(private readonly pg: PgRunner) {}

  async get(bucket: string, path: string): Promise<BlobObjectRecord | null> {
    const row = await this.pg.queryOne<BlobRow>(
      "select * from blob_objects where bucket = $1 and path = $2",
      [bucket, path],
    );
    return row ? rowToRecord(row) : null;
  }

  /**
   * The same lookup for a whole batch, in one round trip.
   *
   * Mirror of `SupabaseBlobRegistry.getMany` on the pooled path, so the route
   * that mints up to 200 signed URLs in one request does one query whichever
   * backend is wired. RLS applies as it does to `get` — the session's user is
   * the filter — and a path the caller cannot see is simply absent from the map.
   */
  async getMany(bucket: string, paths: readonly string[]): Promise<Map<string, BlobObjectRecord>> {
    const out = new Map<string, BlobObjectRecord>();
    if (paths.length === 0) return out;
    const rows = await this.pg.query<BlobRow>(
      "select * from blob_objects where bucket = $1 and path = any($2)",
      [bucket, [...paths]],
    );
    for (const row of rows) {
      const record = rowToRecord(row);
      out.set(record.path, record);
    }
    return out;
  }

  async register(input: RegisterBlobInput): Promise<void> {
    await this.pg.exec(
      `insert into blob_objects (bucket, path, tier, size_bytes, priority)
       values ($1, $2, $3, $4, $5)
       on conflict (bucket, path) do update set
         tier = excluded.tier,
         size_bytes = excluded.size_bytes,
         priority = excluded.priority`,
      [input.bucket, input.path, input.tier ?? "hot", input.sizeBytes, input.priority ?? 50],
    );
  }

  async recordAccess(bucket: string, path: string): Promise<void> {
    await this.pg.exec(
      `update blob_objects
       set access_count = access_count + 1, last_accessed_at = now()
       where bucket = $1 and path = $2`,
      [bucket, path],
    );
  }

  /** The same increment for a batch, in one statement. */
  async recordAccessMany(bucket: string, paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.pg.exec(
      `update blob_objects
       set access_count = access_count + 1, last_accessed_at = now()
       where bucket = $1 and path = any($2)`,
      [bucket, [...paths]],
    );
  }

  async setTier(bucket: string, path: string, tier: BlobTier, sizeBytes?: number): Promise<void> {
    if (sizeBytes !== undefined) {
      await this.pg.exec(
        "update blob_objects set tier = $1, size_bytes = $2 where bucket = $3 and path = $4",
        [tier, sizeBytes, bucket, path],
      );
    } else {
      await this.pg.exec("update blob_objects set tier = $1 where bucket = $2 and path = $3", [
        tier,
        bucket,
        path,
      ]);
    }
  }

  async remove(bucket: string, path: string): Promise<void> {
    await this.pg.exec("delete from blob_objects where bucket = $1 and path = $2", [bucket, path]);
  }

  async listHot(): Promise<BlobObjectRecord[]> {
    const rows = await this.pg.query<BlobRow>("select * from blob_objects where tier = 'hot'");
    return rows.map(rowToRecord);
  }

  async hotBytesTotal(): Promise<number> {
    const row = await this.pg.queryOne<{ total: string }>(
      "select coalesce(sum(size_bytes), 0) as total from blob_objects where tier = 'hot'",
    );
    return Number(row?.total ?? 0);
  }
}
