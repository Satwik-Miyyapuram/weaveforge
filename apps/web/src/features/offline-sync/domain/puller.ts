import { Outbox, type SqlRunner } from "./outbox";
import type { SyncStateStore } from "./sync-state";
import type { RemoteChange, SyncTransport } from "./sync-ports";
import type { ConflictStore } from "./conflicts";

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
    private readonly conflicts?: ConflictStore,
  ) {
    this.outbox = new Outbox(sql);
  }

  private readonly outbox: Outbox;
  private synced: Set<string> | null = null;

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
   * One row, written as the server sent it — unless this device still owes
   * edits for it, in which case the two branches are merged.
   *
   * A tombstone removes the local row. Keeping it with `deleted_at` set left
   * it on every screen, since no screen filters on that column; the watermark,
   * not the row, is what records that this change was received.
   */
  private async apply(change: RemoteChange): Promise<void> {
    // Refuse before reading the outbox, whose ids only fit synced rows.
    this.synced ??= new Set(
      (await this.sql.query<{ table_name: string }>("select table_name from sync_tables")).map(
        (r) => r.table_name,
      ),
    );
    if (!this.synced.has(change.table)) throw new Error(`${change.table} is not a synced table`);
    const ops = await this.outbox.forRow(change.table, change.rowId);
    if (change.deletedAt) {
      // Deleted elsewhere: local edits to it have nowhere to land.
      if (ops.length > 0) await this.outbox.dropRow(change.table, change.rowId);
      await this.write(change);
      return;
    }
    const last = ops[ops.length - 1];
    if (last?.op === "delete") {
      // Deleted here: the delete wins, now against the version the server holds.
      await this.outbox.rebase(change.table, change.rowId, change.rowVersion);
      return;
    }
    // Our own accepted write coming back: local already holds it and more.
    if (ops.length > 0 && ops.every((op) => op.baseVersion != null && op.baseVersion >= change.rowVersion)) {
      return;
    }
    if (ops.length > 0 && this.conflicts) {
      await this.conflicts.openFor(change.table, change.rowId, change.rowVersion);
      await this.write(change);
      await this.conflicts.settle(change.table, change.rowId, change.row, change.rowVersion);
      return;
    }
    await this.write(change);
    // A conflict still open for this row is re-tried against the newer side.
    await this.conflicts?.settle(change.table, change.rowId, change.row, change.rowVersion);
  }

  private async write(change: RemoteChange): Promise<void> {
    await this.sql.exec("select sync_apply($1, $2::jsonb)", [
      change.table,
      JSON.stringify(change.row),
    ]);
  }
}
