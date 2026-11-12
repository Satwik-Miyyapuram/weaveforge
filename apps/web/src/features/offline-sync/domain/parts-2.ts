import { readyCore } from "@/lib/rust-core";
import type { PullFacts } from "@weaveforge/wasm";
import type { ConflictStore } from "./parts-1";
import type { RemoteChange, SyncTransport } from "./parts";
import type { SyncStateStore } from "./parts-3";

// --- outbox ---
/**
 * What this device still owes the server.
 *
 * Writes land in the local database first and always, so the UI never waits on
 * a network it may not have. Each write also appends an op here, and the pump
 * drains this list in order when a connection exists.
 *
 * Two properties carry the whole design. The list is **ordered**, so a create
 * followed by an edit cannot arrive the other way round. Each entry is
 * **idempotent** — it carries an op id the server dedupes on — so an entry may
 * be sent again whenever the answer to "did that land?" is unknown, which after
 * a dropped connection it always is.
 */
export type OutboxOp = "insert" | "update" | "delete";

export interface OutboxEntry {
  seq: number;
  opId: string;
  table: string;
  rowId: string;
  op: OutboxOp;
  payload: Record<string, unknown>;
  /** What the local row was based on. Null for an insert, which is based on nothing. */
  baseVersion: number | null;
  /**
   * The row as it stood when the edit was made.
   *
   * Kept because a three-way merge needs it: without a base, an untouched field
   * cannot be told from an edited one and every collision is a whole-row
   * collision. Null for an insert, which was based on nothing.
   */
  basePayload: Record<string, unknown> | null;
  attempts: number;
  lastError: string | null;
}

export interface OutboxAppend {
  table: string;
  rowId: string;
  op: OutboxOp;
  payload?: Record<string, unknown>;
  baseVersion?: number | null;
  basePayload?: Record<string, unknown> | null;
  /** Supplied only by a caller replaying a known op; otherwise the database picks. */
  opId?: string;
}

/** The three verbs a runner has to offer; `LocalRunner` and `PgRunner` both do. */
export interface SqlRunner {
  query<T>(sql: string, params?: (string | number | boolean | null)[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: (string | number | boolean | null)[]): Promise<T | null>;
  exec(sql: string, params?: (string | number | boolean | null)[]): Promise<void>;
}

/**
 * How many times an op is retried before it stops being retried.
 *
 * Not infinity: an op the server will never accept would otherwise block every
 * op behind it forever, which turns one bad write into a device that has
 * stopped syncing without saying so. Not one, either — the common failure is a
 * flaky network, and giving up on the first refusal would strand work that a
 * second attempt would have delivered.
 */
export const OUTBOX_MAX_ATTEMPTS = 8;

interface OutboxRow {
  seq: string | number;
  op_id: string;
  table_name: string;
  row_id: string;
  op: OutboxOp;
  payload: Record<string, unknown>;
  base_payload: Record<string, unknown> | null;
  base_version: number | null;
  attempts: number;
  last_error: string | null;
}

/** Row to entry (`toEntry`, Rust `sync::outbox_rows`); a whole result set maps in one call. */
function toEntries(rows: OutboxRow[]): OutboxEntry[] {
  return readyCore().outboxEntries(rows) as OutboxEntry[];
}

const COLUMNS =
  "seq, op_id, table_name, row_id, op, payload, base_version, base_payload, attempts, last_error";

export class Outbox {
  constructor(private readonly sql: SqlRunner) {}

  /** Append an op and return it as it was stored, id included. */
  async append(entry: OutboxAppend): Promise<OutboxEntry> {
    const row = await this.sql.queryOne<OutboxRow>(
      `insert into sync_outbox (op_id, table_name, row_id, op, payload, base_version, base_payload)
       values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5::jsonb, $6, $7::jsonb)
       returning ${COLUMNS}`,
      [
        entry.opId ?? null,
        entry.table,
        entry.rowId,
        entry.op,
        JSON.stringify(entry.payload ?? {}),
        entry.baseVersion ?? null,
        entry.basePayload ? JSON.stringify(entry.basePayload) : null,
      ],
    );
    if (!row) throw new Error("The op could not be recorded locally.");
    return toEntries([row])[0]!;
  }

  /**
   * The next ops to send, oldest first.
   *
   * Dead entries are skipped rather than removed: an op that cannot be sent is
   * work somebody did, and deleting it would be the one failure mode this whole
   * design exists to avoid.
   */
  async pending(limit = 100): Promise<OutboxEntry[]> {
    const rows = await this.sql.query<OutboxRow>(
      `select ${COLUMNS} from sync_outbox where dead_at is null order by seq limit $1`,
      [Math.max(1, limit)],
    );
    return toEntries(rows);
  }

  /** The server took it; it is no longer owed. */
  async settle(opId: string): Promise<void> {
    await this.sql.exec("delete from sync_outbox where op_id = $1", [opId]);
  }

  /**
   * The server took this op. Removed only if it is still what was sent: an edit
   * made during the send coalesced into it, and that edit is still owed — now
   * an update based on the version the server just gave.
   */
  async settleSent(entry: OutboxEntry, newVersion?: number): Promise<void> {
    const gone = await this.sql.query<{ seq: string }>(
      "delete from sync_outbox where op_id = $1 and op = $2 and payload = $3::jsonb returning seq",
      [entry.opId, entry.op, JSON.stringify(entry.payload)],
    );
    if (gone.length > 0) return;
    await this.sql.exec(
      `update sync_outbox
          set op = case when op = 'insert' then 'update' else op end,
              base_version = coalesce($2, base_version), base_payload = $3::jsonb
        where op_id = $1`,
      [entry.opId, newVersion ?? null, JSON.stringify(entry.payload)],
    );
  }

  /** Later ops on a row now build on `version`, the one the server holds. */
  async rebase(table: string, rowId: string, version: number): Promise<void> {
    await this.sql.exec(
      `update sync_outbox set base_version = $3
        where table_name = $1 and row_id = $2 and dead_at is null and op <> 'insert'`,
      [table, rowId, version],
    );
  }

  /** The server now holds `version` of this row; local row and later ops follow it. */
  async ack(table: string, rowId: string, version: number): Promise<void> {
    await this.sql.exec("select sync_ack($1, $2, $3)", [table, rowId, version]);
    await this.rebase(table, rowId, version);
  }

  /** Every live op for one row, oldest first. */
  async forRow(table: string, rowId: string): Promise<OutboxEntry[]> {
    const rows = await this.sql.query<OutboxRow>(
      `select ${COLUMNS} from sync_outbox
        where table_name = $1 and row_id = $2 and dead_at is null order by seq`,
      [table, rowId],
    );
    return toEntries(rows);
  }

  /** Forget what this device owed for a row; a merge now speaks for it. */
  async dropRow(table: string, rowId: string): Promise<void> {
    await this.sql.exec(
      "delete from sync_outbox where table_name = $1 and row_id = $2 and dead_at is null",
      [table, rowId],
    );
  }

  /** Send an edit again as the insert the server never got; its payload is the whole row. */
  async reinsert(opId: string, reason: string): Promise<void> {
    await this.sql.exec(
      `update sync_outbox
          set op = 'insert', base_version = null, base_payload = null,
              attempts = attempts + 1, last_error = $2
        where op_id = $1`,
      [opId, reason],
    );
  }

  /**
   * The attempt failed. Record why, and stop retrying once that has happened
   * enough times — the entry stays, so it can be shown and retried by hand.
   */
  async fail(opId: string, reason: string): Promise<void> {
    await this.sql.exec(
      `update sync_outbox
          set attempts = attempts + 1,
              last_error = $2,
              dead_at = case when attempts + 1 >= $3 then now() else null end
        where op_id = $1`,
      [opId, reason, OUTBOX_MAX_ATTEMPTS],
    );
  }

  /**
   * The attempt failed for a reason that can pass, such as a parent row the
   * server does not hold yet. Record why, but never stop retrying: given up on,
   * the row would stay off the server after the parent went up.
   */
  async wait(opId: string, reason: string): Promise<void> {
    await this.sql.exec(
      "update sync_outbox set attempts = attempts + 1, last_error = $2, dead_at = null where op_id = $1",
      [opId, reason],
    );
  }

  /** Ops that have stopped being retried, for the list a person can act on. */
  async dead(): Promise<OutboxEntry[]> {
    const rows = await this.sql.query<OutboxRow>(
      `select ${COLUMNS} from sync_outbox where dead_at is not null order by seq`,
    );
    return toEntries(rows);
  }

  /** Put a dead entry back in the queue, unchanged, with its history cleared. */
  async revive(opId: string): Promise<void> {
    await this.sql.exec(
      "update sync_outbox set dead_at = null, attempts = 0, last_error = null where op_id = $1",
      [opId],
    );
  }
}

// --- puller ---
type Row = Record<string, unknown>;
type Found = Awaited<ReturnType<ConflictStore["find"]>>;

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
    let failed: Held[] = [];
    for (const change of changes) {
      if (await this.tryApply(change, failed)) applied += 1;
    }
    const summary = readyCore().pullSummary({
      watermark,
      pageSize,
      // The Rust side reads only table, rowId and serverSeq; extra fields are ignored.
      fetched: changes,
      failed: failed.map((f) => f.change),
    });
    // A second pass catches rows that clashed with something later in the page.
    const again: Held[] = [];
    for (const [i, { change }] of failed.entries()) {
      // A later change to the same row already won; this one is stale.
      if (summary.stale[i]) continue;
      if (await this.tryApply(change, again)) applied += 1;
    }
    failed = await this.applyGroups(again, (n) => (applied += n));
    for (const held of failed) await this.hold(held);
    if (summary.highest > watermark) await this.state.advance(summary.highest);
    const count = await this.heldCount();
    if (count > 0) console.warn(`sync: ${count} pulled change(s) held`, failed.map((f) => `${f.change.table}/${f.change.rowId}: ${f.error}`));
    return { applied, watermark: summary.highest, more: summary.more, held: count };
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
    const candidates: Held[] = [];
    for (const f of failed) {
      const uniqueClash = readyCore().isUniqueClash(f.error);
      // Only a candidate needs its pending ops read.
      const pendingOps =
        f.change.deletedAt || !uniqueClash
          ? 0
          : (await this.outbox.forRow(f.change.table, f.change.rowId)).length;
      if (!readyCore().groupEligible({ deleted: !!f.change.deletedAt, uniqueClash, pendingOps })) continue;
      candidates.push(f);
    }
    const landed = new Set<Held>();
    for (const indexes of readyCore().tableGroups(candidates.map((f) => f.change.table))) {
      const group = indexes.flatMap((i) => {
        const held = candidates[i];
        return held ? [held] : [];
      });
      const table = group[0]?.change.table;
      if (table === undefined) continue;
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
    // The conflict lookup runs only where the decision can read it: a last op of
    // delete settles the row without it, as before the port.
    const lastIsDelete = ops[ops.length - 1]?.op === "delete";
    const found: Found = lastIsDelete ? null : ((await this.conflicts?.find(change.table, change.rowId)) ?? null);
    const facts: PullFacts = {
      deleted: !!change.deletedAt,
      rowVersion: change.rowVersion,
      ops: ops.map((o) => ({ op: o.op, baseVersion: o.baseVersion ?? null })),
      hasStore: !!this.conflicts,
      open: found?.kind ?? null,
      referenced: change.deletedAt != null && ops.length === 0 && !found && (await this.referenced(change.table, change.rowId)),
    };
    switch (readyCore().pullApplyStep(facts)) {
      case "tombstone":
        return this.tombstone(change, facts, found);
      case "skip":
        return;
      case "openDeletedLocal":
        await this.conflicts!.openDeletedLocal(change.table, change.rowId, change.row, change.rowVersion);
        return;
      case "rebase":
        await this.outbox.rebase(change.table, change.rowId, change.rowVersion);
        return;
      case "settleOnly":
        await this.conflicts!.settle(change.table, change.rowId, change.row, change.rowVersion);
        return;
      case "openAndWrite":
        await this.conflicts!.openFor(change.table, change.rowId, change.rowVersion);
        await this.write(change);
        await this.conflicts!.settle(change.table, change.rowId, change.row, change.rowVersion);
        return;
      case "writeAndSettle":
        await this.write(change);
        // A conflict still open for this row is re-tried against the newer side.
        await this.conflicts?.settle(change.table, change.rowId, change.row, change.rowVersion);
        return;
      case "writeOnly":
        await this.write(change);
        return;
    }
  }

  /**
   * Deleted elsewhere. Local edits to it, or to rows that point at it, are never
   * thrown away: the row stays and the reader chooses whether it goes.
   */
  private async tombstone(change: RemoteChange, facts: PullFacts, found: Found): Promise<void> {
    const { table, rowId } = change;
    switch (readyCore().pullTombstoneStep(facts)) {
      case "dropAndWrite":
        // Deleted here too: nothing to decide.
        await this.outbox.dropRow(table, rowId);
        await this.write(change);
        return;
      case "keep":
        return;
      case "resolveAndWrite":
        // Both sides deleted it.
        await this.conflicts!.resolve(found!.id);
        await this.write(change);
        return;
      case "openDeletedRemote":
        await this.conflicts!.openDeletedRemote(table, rowId);
        return;
      case "refuse":
        throw new Error("Deleted elsewhere while edited here; kept until decided.");
      case "write":
        await this.write(change);
        return;
    }
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
    const constraint = readyCore().uniqueConstraintName(String((error as Error)?.message));
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
         from public.${readyCore().quoteIdent(table)} t where id = $2`,
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
