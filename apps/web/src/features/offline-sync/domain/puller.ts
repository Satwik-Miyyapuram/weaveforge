import type { SqlRunner } from "./outbox";
import type { SyncStateStore } from "./sync-state";
import type { RemoteChange, SyncTransport } from "./sync-ports";

/**
 * Reads the server's change feed and writes what it says into the local
 * database, then remembers how far it got.
 *
 * The watermark advances only after the rows before it are written, and only to
 * the highest sequence actually applied. A watermark moved first — or moved to
 * the end of a page that failed halfway — would silently skip changes, and the
 * device would never learn it had.
 *
 * The puller is the only part that trusts the server, and it pulls rather than
 * listens. A socket that has quietly stopped delivering looks exactly like a
 * system where nothing is happening, so realtime can shorten the wait but can
 * never be what makes this correct.
 */

export interface PullResult {
  applied: number;
  watermark: number;
  /** Whether the server had more waiting than one page could carry. */
  more: boolean;
}

export class Puller {
  constructor(
    private readonly sql: SqlRunner,
    private readonly state: SyncStateStore,
    private readonly transport: SyncTransport,
  ) {}

  async pull(pageSize = 500): Promise<PullResult> {
    const { watermark } = await this.state.read();
    const changes = await this.transport.changesSince(watermark, pageSize);
    let applied = 0;
    let highest = watermark;
    for (const change of changes) {
      await this.apply(change);
      applied += 1;
      highest = Math.max(highest, change.serverSeq);
    }
    if (highest > watermark) await this.state.advance(highest);
    return { applied, watermark: highest, more: changes.length >= pageSize };
  }

  /**
   * One row, written as the server sent it.
   *
   * A tombstone is applied like any other row: the local copy keeps
   * `deleted_at` set rather than disappearing, because a row that vanished
   * locally is indistinguishable from one never received, and the next pull
   * would have nothing to correct.
   */
  private async apply(change: RemoteChange): Promise<void> {
    await this.sql.exec("select sync_apply($1, $2::jsonb)", [
      change.table,
      JSON.stringify(change.row),
    ]);
  }
}
