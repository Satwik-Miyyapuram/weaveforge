import type { SqlRunner } from "./outbox";

/**
 * How far this device has read the server, and whose data it holds.
 *
 * One row, because a device has one answer to both questions. The watermark is
 * the server's own sequence number, never a timestamp: a device whose clock is
 * wrong would otherwise re-read everything or, worse, skip it.
 */

export interface SyncState {
  watermark: number;
  lastPullAt: string | null;
  /** Null until sync is turned on; also the id local rows are re-owned to. */
  accountId: string | null;
}

interface SyncStateRow {
  watermark: string | number;
  last_pull_at: string | null;
  account_id: string | null;
}

export class SyncStateStore {
  constructor(private readonly sql: SqlRunner) {}

  async read(): Promise<SyncState> {
    const row = await this.sql.queryOne<SyncStateRow>(
      "select watermark, last_pull_at, account_id from sync_state",
    );
    return {
      watermark: Number(row?.watermark ?? 0),
      lastPullAt: row?.last_pull_at ?? null,
      accountId: row?.account_id ?? null,
    };
  }

  /**
   * Move the watermark forward, and only forward.
   *
   * A pull that answered out of order, or a retry that carried an older
   * high-water mark, must not rewind it — rewinding means re-applying changes
   * the device already has, and for a delete that has since been re-created
   * locally that is data loss rather than wasted work.
   */
  async advance(watermark: number): Promise<void> {
    await this.sql.exec(
      "update sync_state set watermark = greatest(watermark, $1), last_pull_at = now()",
      [watermark],
    );
  }

  /** Record whose account this device now syncs with. */
  async adopt(accountId: string): Promise<void> {
    await this.sql.exec("update sync_state set account_id = $1", [accountId]);
  }
}
