import type { SqlRunner } from "./outbox";

/**
 * The files kept on this device, and the ceiling they live under.
 *
 * A cache without a ceiling is a disk that fills up, and the person only finds
 * out when something else on their machine breaks. So there is a quota, and
 * going over it evicts rather than refuses: what was asked for most recently is
 * what the person is doing now, and the oldest untouched file is the cheapest
 * thing to lose — it can always be fetched again.
 *
 * Files belonging to no enabled project go first, whatever their age. Turning a
 * project off is a statement about what the device should be spending space on,
 * and honouring it only once the quota is hit would make the control look inert.
 */

/**
 * The default ceiling: two gigabytes of PDFs, which is a few hundred papers
 * and small enough that a laptop never notices it went missing.
 */
export const DEFAULT_OFFLINE_QUOTA = 2 * 1024 ** 3;

export interface CachedBlob {
  path: string;
  projectId: string | null;
  bytes: number;
  lastUsedAt: string;
}

export interface BlobUsage {
  bytes: number;
  files: number;
  quota: number;
}

/** How the cache reaches the bytes themselves. */
export interface BlobStorage {
  remove(path: string): Promise<void>;
}

interface BlobRow {
  path: string;
  project_id: string | null;
  bytes: string | number;
  last_used_at: string;
}

const toBlob = (row: BlobRow): CachedBlob => ({
  path: row.path,
  projectId: row.project_id,
  bytes: Number(row.bytes),
  lastUsedAt: row.last_used_at,
});

export class BlobCache {
  constructor(
    private readonly sql: SqlRunner,
    private readonly storage: BlobStorage,
    private readonly quota: number,
  ) {}

  /** A file has landed on disk. Re-storing one keeps a single row. */
  async store(path: string, projectId: string | null, bytes: number): Promise<void> {
    await this.sql.exec(
      `insert into offline_blobs (path, project_id, bytes)
       values ($1, $2, $3)
       on conflict (path) do update
          set bytes = excluded.bytes, project_id = excluded.project_id, last_used_at = now()`,
      [path, projectId, bytes],
    );
  }

  /** Read, not written: this is what makes eviction least-recently-*used*. */
  async touch(path: string): Promise<void> {
    await this.sql.exec("update offline_blobs set last_used_at = now() where path = $1", [path]);
  }

  async usage(): Promise<BlobUsage> {
    const row = await this.sql.queryOne<{ bytes: string | null; files: string }>(
      "select coalesce(sum(bytes), 0) as bytes, count(*) as files from offline_blobs",
    );
    return { bytes: Number(row?.bytes ?? 0), files: Number(row?.files ?? 0), quota: this.quota };
  }

  /**
   * Bring the cache back under its ceiling, and report what was dropped.
   *
   * Eviction removes the bytes first and the row second. The other order can
   * leave a row for a file that is gone, which reads as cached and fails on
   * open; an orphaned file merely costs space until the next sweep.
   */
  async evict(): Promise<CachedBlob[]> {
    const dropped: CachedBlob[] = [];
    const orphans = await this.sql.query<BlobRow>(
      `select path, project_id, bytes, last_used_at from offline_blobs
        where project_id is not null
          and project_id not in (select project_id from offline_projects)`,
    );
    for (const row of orphans) dropped.push(await this.drop(toBlob(row)));

    let { bytes } = await this.usage();
    if (bytes <= this.quota) return dropped;

    const oldest = await this.sql.query<BlobRow>(
      `select path, project_id, bytes, last_used_at from offline_blobs order by last_used_at`,
    );
    for (const row of oldest) {
      if (bytes <= this.quota) break;
      const blob = toBlob(row);
      dropped.push(await this.drop(blob));
      bytes -= blob.bytes;
    }
    return dropped;
  }

  private async drop(blob: CachedBlob): Promise<CachedBlob> {
    await this.storage.remove(blob.path);
    await this.sql.exec("delete from offline_blobs where path = $1", [blob.path]);
    return blob;
  }
}
