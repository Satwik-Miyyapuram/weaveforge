import { Outbox, type OutboxEntry, type SqlRunner } from "./outbox";
import type { SyncStateStore } from "./sync-state";
import type { RemoteChange, SyncTransport } from "./sync-ports";
import type { ConflictStore } from "./conflicts";
import { quoteIdent } from "./sql-ident";

type Row = Record<string, unknown>;

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
   * not the row, is what records that this change was received. Local edits
   * are never dropped by it: the reader decides (see `tombstone`).
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
      await this.tombstone(change, ops);
      return;
    }
    const last = ops[ops.length - 1];
    if (last?.op === "delete") {
      // Our own delete's base: nothing changed there since.
      if (last.baseVersion != null && last.baseVersion >= change.rowVersion) return;
      // Deleted here, edited elsewhere since: the reader decides.
      if (this.conflicts && last.baseVersion != null) {
        await this.conflicts.openDeletedLocal(change.table, change.rowId, change.row, change.rowVersion);
        return;
      }
      await this.outbox.rebase(change.table, change.rowId, change.rowVersion);
      return;
    }
    // Deleted here and waiting on the reader: the row stays gone, the newest cloud copy is kept.
    const open = await this.conflicts?.find(change.table, change.rowId);
    if (open?.kind === "deleted_local") {
      await this.conflicts!.settle(change.table, change.rowId, change.row, change.rowVersion);
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

  /**
   * Deleted elsewhere. Local edits to it, or to rows that point at it, are never
   * thrown away: the row stays and the reader chooses whether it goes.
   */
  private async tombstone(change: RemoteChange, ops: OutboxEntry[]): Promise<void> {
    const { table, rowId } = change;
    // Deleted here too: nothing to decide.
    if (ops[ops.length - 1]?.op === "delete") {
      await this.outbox.dropRow(table, rowId);
      await this.write(change);
      return;
    }
    const open = await this.conflicts?.find(table, rowId);
    if (open?.kind === "deleted_remote") return;
    if (open?.kind === "deleted_local") {
      // Both sides deleted it.
      await this.conflicts!.resolve(open.id);
      await this.write(change);
      return;
    }
    if (ops.length > 0 || open || (await this.referenced(table, rowId))) {
      if (!this.conflicts) throw new Error("Deleted elsewhere while edited here; kept until decided.");
      await this.conflicts.openDeletedRemote(table, rowId);
      return;
    }
    await this.write(change);
  }

  /** Whether an edit still owed to the server points at this row. */
  private async referenced(table: string, rowId: string): Promise<boolean> {
    const row = await this.sql.queryOne(
      `select 1 from sync_outbox o, jsonb_each_text(o.payload) e
        where o.op <> 'delete' and e.key <> 'id' and e.value = $1
          and not (o.table_name = $2 and o.row_id::text = $1)
        limit 1`,
      [rowId, table],
    );
    return row != null;
  }

  private async write(change: RemoteChange): Promise<void> {
    const run = () =>
      this.sql.exec("select sync_apply($1, $2::jsonb)", [change.table, JSON.stringify(change.row)]);
    try {
      await run();
    } catch (error) {
      // The merge writes the server row itself.
      if (!(await this.mergeLocalTwin(change, error))) throw error;
    }
  }

  /**
   * A row made here that never reached the server can clash on a natural key
   * (same paper added twice) with the server's copy; one such row blocked every
   * later pull, and its children every push. Fold it into the server's copy;
   * where the two copies disagree, the reader decides (an open conflict), as
   * for children that clashed the same way.
   */
  private async mergeLocalTwin(change: RemoteChange, error: unknown): Promise<boolean> {
    const constraint = /unique constraint "([^"]+)"/.exec(String((error as Error)?.message))?.[1];
    if (!constraint) return false;
    const twin = await this.sql.queryOne<{ id: string | null }>(
      "select sync_twin_of($1, $2, $3::jsonb)::text as id",
      [change.table, constraint, JSON.stringify(change.row)],
    );
    if (!twin?.id) return false;
    const localOnly = await this.sql.queryOne(
      "select 1 from sync_outbox where table_name = $1 and row_id = $2 and op = 'insert'",
      [change.table, twin.id],
    );
    if (!localOnly) return false;
    const mine = await this.payload(change.table, twin.id);
    const merged = await this.sql.queryOne<{ folded: FoldedChild[] | string }>(
      "select sync_merge_twin($1, $2::uuid, $3::jsonb) as folded",
      [change.table, twin.id, JSON.stringify(change.row)],
    );
    if (!this.conflicts) return true;
    if (mine) {
      const { row_version: _, ...local } = mine;
      await this.conflicts.openFolded(change.table, change.rowId, { ...local, id: change.rowId }, change.row, change.rowVersion);
    }
    const folded = merged?.folded;
    for (const child of (typeof folded === "string" ? JSON.parse(folded) : folded ?? []) as FoldedChild[]) {
      const remote = await this.payload(child.table, child.row_id);
      if (!remote) continue;
      const version = typeof remote.row_version === "number" ? remote.row_version : null;
      await this.conflicts.openFolded(child.table, child.row_id, child.local, remote, version);
    }
    return true;
  }

  /** A local row as the server would hold it, with its version. */
  private async payload(table: string, id: string): Promise<Row | null> {
    const row = await this.sql.queryOne<{ row: Row }>(
      `select sync_payload($1, to_jsonb(t)) || jsonb_build_object('row_version', t.row_version) as row
         from public.${quoteIdent(table)} t where id = $2`,
      [table, id],
    );
    return row?.row ?? null;
  }
}

interface FoldedChild {
  table: string;
  row_id: string;
  local: Row;
}

