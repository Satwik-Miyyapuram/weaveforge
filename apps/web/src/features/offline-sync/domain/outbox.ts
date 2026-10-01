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

function toEntry(row: OutboxRow): OutboxEntry {
  return {
    seq: Number(row.seq),
    opId: row.op_id,
    table: row.table_name,
    rowId: row.row_id,
    op: row.op,
    payload: row.payload,
    baseVersion: row.base_version,
    basePayload: row.base_payload ?? null,
    attempts: row.attempts,
    lastError: row.last_error,
  };
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
    return toEntry(row);
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
    return rows.map(toEntry);
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
    return rows.map(toEntry);
  }

  /** Forget what this device owed for a row; a merge now speaks for it. */
  async dropRow(table: string, rowId: string): Promise<void> {
    await this.sql.exec(
      "delete from sync_outbox where table_name = $1 and row_id = $2 and dead_at is null",
      [table, rowId],
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

  /** Ops that have stopped being retried, for the list a person can act on. */
  async dead(): Promise<OutboxEntry[]> {
    const rows = await this.sql.query<OutboxRow>(
      `select ${COLUMNS} from sync_outbox where dead_at is not null order by seq`,
    );
    return rows.map(toEntry);
  }

  /** Put a dead entry back in the queue, unchanged, with its history cleared. */
  async revive(opId: string): Promise<void> {
    await this.sql.exec(
      "update sync_outbox set dead_at = null, attempts = 0, last_error = null where op_id = $1",
      [opId],
    );
  }
}
