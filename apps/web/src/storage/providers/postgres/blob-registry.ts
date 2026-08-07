import type {
  BlobObjectRecord,
  BlobTier,
  IBlobRegistry,
  RegisterBlobInput,
} from "@weaveforge/core";
import type { PgRunner } from "@/backend/providers/postgres/pg-runner";

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
