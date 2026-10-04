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
    const run = () =>
      this.sql.exec("select sync_apply($1, $2::jsonb)", [change.table, JSON.stringify(change.row)]);
    try {
      await run();
    } catch (error) {
      if (!(await this.dropLocalTwin(change, error))) throw error;
      await run();
    }
  }

  /**
   * A row made here that never reached the server can clash on a natural key
   * (same paper added twice) with the server's copy; one such row blocked every
   * later pull. Drop it when nothing points at it, so the server copy lands.
   */
  private async dropLocalTwin(change: RemoteChange, error: unknown): Promise<boolean> {
    const constraint = /unique constraint "([^"]+)"/.exec(String((error as Error)?.message))?.[1];
    if (!constraint) return false;
    const cols = (
      await this.sql.query<{ name: string }>(
        `select a.attname as name from pg_index x
           join pg_class i on i.oid = x.indexrelid
           join pg_class t on t.oid = x.indrelid
           join pg_attribute a on a.attrelid = t.oid and a.attnum = any(x.indkey)
          where x.indisunique and i.relname = $1 and t.relname = $2`,
        [constraint, change.table],
      )
    ).map((r) => r.name);
    if (cols.length === 0 || cols.includes("id")) return false;
    const match = cols.map((c) => `t.${quote(c)} is not distinct from r.${quote(c)}`).join(" and ");
    const twin = await this.sql.queryOne<{ id: string }>(
      `select t.id::text as id from public.${quote(change.table)} t,
              jsonb_populate_record(null::public.${quote(change.table)}, $1) r
        where ${match} and t.id <> r.id`,
      [JSON.stringify(change.row)],
    );
    if (!twin) return false;
    const localOnly = await this.sql.queryOne(
      "select 1 from sync_outbox where table_name = $1 and row_id = $2 and op = 'insert'",
      [change.table, twin.id],
    );
    if (!localOnly) return false;
    const refs = await this.sql.query<{ child: string; col: string }>(
      `select ch.relname as child, a.attname as col from pg_constraint c
         join pg_class p on p.oid = c.confrelid
         join pg_class ch on ch.oid = c.conrelid
         join pg_attribute a on a.attrelid = ch.oid and a.attnum = c.conkey[1]
        where c.contype = 'f' and p.relname = $1 and p.relnamespace = 'public'::regnamespace`,
      [change.table],
    );
    for (const ref of refs) {
      const used = await this.sql.queryOne(
        `select 1 from public.${quote(ref.child)} where ${quote(ref.col)} = $1 limit 1`,
        [twin.id],
      );
      if (used) return false;
    }
    await this.sql.exec("delete from sync_outbox where table_name = $1 and row_id = $2", [
      change.table,
      twin.id,
    ]);
    await this.sql.exec(`delete from public.${quote(change.table)} where id = $1`, [twin.id]);
    return true;
  }
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
