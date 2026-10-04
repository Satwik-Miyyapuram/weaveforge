import { Outbox, type SqlRunner } from "./outbox";
import type { SyncStateStore } from "./sync-state";
import type { RemoteChange, SyncTransport } from "./sync-ports";
import type { ConflictStore } from "./conflicts";

/**
 * Reads the server's change feed and writes what it says into the local
 * database, then remembers how far it got.
 *
 * The watermark advances only after every row of the page is either written or
 * parked in `sync_pull_held`. A row that will not apply is parked and retried on
 * every pull rather than allowed to stop the feed: one such row once blocked all
 * sync for a device. Nothing is skipped silently — the held row keeps the change.
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
  /** Changes parked because they would not apply; retried every pull. */
  held?: number;
}

interface Held {
  change: RemoteChange;
  error: string;
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
    let applied = await this.retryHeld();
    const changes = await this.transport.changesSince(watermark, pageSize);
    let highest = watermark;
    let failed: Held[] = [];
    for (const change of changes) {
      highest = Math.max(highest, change.serverSeq);
      if (await this.tryApply(change, failed)) applied += 1;
    }
    // A second pass catches rows that clashed with something later in the page.
    const newest = new Map<string, number>();
    for (const c of changes) newest.set(`${c.table}/${c.rowId}`, Math.max(newest.get(`${c.table}/${c.rowId}`) ?? 0, c.serverSeq));
    const again: Held[] = [];
    for (const { change } of failed) {
      // A later change to the same row already won; this one is stale.
      if (newest.get(`${change.table}/${change.rowId}`)! > change.serverSeq) continue;
      if (await this.tryApply(change, again)) applied += 1;
    }
    failed = await this.applyGroups(again, (n) => (applied += n));
    for (const held of failed) await this.hold(held);
    if (highest > watermark) await this.state.advance(highest);
    const count = await this.heldCount();
    if (count > 0) console.warn(`sync: ${count} pulled change(s) held`, failed.map((f) => `${f.change.table}/${f.change.rowId}: ${f.error}`));
    return { applied, watermark: highest, more: changes.length >= pageSize, held: count };
  }

  private async tryApply(change: RemoteChange, failed: Held[]): Promise<boolean> {
    try {
      await this.apply(change);
    } catch (error) {
      failed.push({ change, error: String((error as Error)?.message ?? error) });
      return false;
    }
    await this.sql.exec("delete from sync_pull_held where table_name = $1 and row_id = $2 and server_seq <= $3", [
      change.table,
      change.rowId,
      change.serverSeq,
    ]);
    return true;
  }

  /** Rows of one table that only clash with each other land together. */
  private async applyGroups(failed: Held[], count: (n: number) => void): Promise<Held[]> {
    const byTable = new Map<string, Held[]>();
    for (const f of failed) {
      if (f.change.deletedAt || !/unique constraint/.test(f.error)) continue;
      if ((await this.outbox.forRow(f.change.table, f.change.rowId)).length > 0) continue;
      byTable.set(f.change.table, [...(byTable.get(f.change.table) ?? []), f]);
    }
    const landed = new Set<Held>();
    for (const [table, group] of byTable) {
      if (group.length < 2) continue;
      try {
        await this.sql.exec("select sync_apply_group($1, $2::jsonb)", [table, JSON.stringify(group.map((g) => g.change.row))]);
      } catch {
        continue;
      }
      for (const g of group) {
        landed.add(g);
        await this.sql.exec("delete from sync_pull_held where table_name = $1 and row_id = $2", [table, g.change.rowId]);
      }
      count(group.length);
    }
    return failed.filter((f) => !landed.has(f));
  }

  private async retryHeld(): Promise<number> {
    const rows = await this.sql.query<{ change: RemoteChange | string }>(
      "select change from sync_pull_held order by server_seq",
    );
    let applied = 0;
    const failed: Held[] = [];
    for (const row of rows) {
      const change = (typeof row.change === "string" ? JSON.parse(row.change) : row.change) as RemoteChange;
      if (await this.tryApply(change, failed)) applied += 1;
    }
    for (const { change, error } of await this.applyGroups(failed, (n) => (applied += n))) {
      await this.sql.exec(
        "update sync_pull_held set attempts = attempts + 1, error = $3, last_at = now() where table_name = $1 and row_id = $2",
        [change.table, change.rowId, error],
      );
    }
    return applied;
  }

  private async hold({ change, error }: Held): Promise<void> {
    // Keep only the newest change per row; an older one would undo it.
    await this.sql.exec(
      `insert into sync_pull_held (table_name, row_id, server_seq, change, error)
       values ($1, $2, $3, $4::jsonb, $5)
       on conflict (table_name, row_id) do update
         set server_seq = excluded.server_seq, change = excluded.change, error = excluded.error,
             attempts = sync_pull_held.attempts + 1, last_at = now()
         where excluded.server_seq >= sync_pull_held.server_seq`,
      [change.table, change.rowId, change.serverSeq, JSON.stringify(change), error],
    );
  }

  private async heldCount(): Promise<number> {
    const row = await this.sql.queryOne<{ n: number | string }>("select count(*) as n from sync_pull_held");
    return Number(row?.n ?? 0);
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
   * Expression indexes are left alone; a partial index's predicate is applied too,
   * so only the row the index actually covers is taken for the twin.
   */
  private async dropLocalTwin(change: RemoteChange, error: unknown): Promise<boolean> {
    const constraint = /unique constraint "([^"]+)"/.exec(String((error as Error)?.message))?.[1];
    if (!constraint) return false;
    const index = await this.sql.query<{ name: string; pred: string | null }>(
      `select a.attname as name, pg_get_expr(x.indpred, x.indrelid) as pred from pg_index x
         join pg_class i on i.oid = x.indexrelid
         join pg_class t on t.oid = x.indrelid
         join pg_attribute a on a.attrelid = t.oid and a.attnum = any(x.indkey)
        where x.indisunique and i.relname = $1 and t.relname = $2 and x.indexprs is null`,
      [constraint, change.table],
    );
    const cols = index.map((r) => r.name);
    const pred = index[0]?.pred ?? "true";
    if (cols.length === 0 || cols.includes("id")) return false;
    const match = cols.map((c) => `t.${quote(c)} is not distinct from r.${quote(c)}`).join(" and ");
    const twin = await this.sql.queryOne<{ id: string }>(
      `select id::text as id from (select t.* from public.${quote(change.table)} t,
              jsonb_populate_record(null::public.${quote(change.table)}, $1) r
        where ${match} and t.id <> r.id) t where ${pred}`,
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
