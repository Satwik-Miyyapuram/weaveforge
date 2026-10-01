import { mergeRows, type FieldConflict, type Row } from "./merge";
import { Outbox, type SqlRunner } from "./outbox";

/**
 * The disagreements the device could not settle, and how they get settled.
 *
 * A conflict is opened when the server turns out to hold a newer version of a
 * row this device still owes edits for — by the pump on a refusal, or by the
 * puller when the change feed brings it — and settled once the server's row
 * is in hand.
 *
 * Most completed conflicts resolve themselves. Two devices editing different
 * fields of the same row collide on the version and not on the work, and
 * reporting that to the reader would teach them to ignore the report.
 */

export interface OpenConflict {
  id: string;
  table: string;
  rowId: string;
  base: Row;
  local: Row;
  remote: Row | null;
  fields: FieldConflict[];
  serverVersion: number | null;
  createdAt: string;
}

interface ConflictRow {
  id: string;
  table_name: string;
  row_id: string;
  base: Row;
  local: Row;
  remote: Row | null;
  fields: FieldConflict[] | null;
  server_version: number | null;
  created_at: string;
}

const COLUMNS = "id, table_name, row_id, base, local, remote, fields, server_version, created_at";

export class ConflictStore {
  constructor(private readonly sql: SqlRunner) {}

  /**
   * Two sides of a disagreement, taken from what this device still owes for
   * the row: the base its first unsent edit started from, and its latest
   * state. The ops are dropped — the conflict now speaks for them, and the
   * merge queues one op of its own.
   *
   * An insert has no base; `{}` makes every field the two sides set
   * differently a question, which is what "both created it" means.
   */
  async openFor(table: string, rowId: string, serverVersion: number | null): Promise<void> {
    const outbox = new Outbox(this.sql);
    const ops = (await outbox.forRow(table, rowId)).filter((op) => op.op !== "delete");
    const first = ops[0];
    const last = ops[ops.length - 1];
    if (!first || !last) return;
    await this.sql.exec(
      `insert into sync_conflicts (table_name, row_id, base, local, server_version)
       values ($1, $2, $3::jsonb, $4::jsonb, $5)
       on conflict (table_name, row_id) where resolved_at is null
       do update set local = excluded.local, server_version = excluded.server_version`,
      [
        table,
        rowId,
        JSON.stringify(first.basePayload ?? {}),
        JSON.stringify(last.payload),
        serverVersion,
      ],
    );
    await outbox.dropRow(table, rowId);
  }

  /** Write the server's row locally without queueing it back. */
  async applyRemote(table: string, row: Row): Promise<void> {
    await this.sql.exec("select sync_apply($1, $2::jsonb)", [table, JSON.stringify(row)]);
  }

  /**
   * The server's side has arrived; merge.
   *
   * A clean merge is written locally and queued as one update on the server's
   * version, so nobody is asked about two edits to different fields. A real
   * disagreement stays open with the server's row standing until the reader
   * chooses — a device showing its own unsent version would be showing
   * something nobody else can see.
   */
  async settle(
    table: string,
    rowId: string,
    remote: Row,
    remoteVersion?: number | null,
  ): Promise<Row | null> {
    const row = await this.sql.queryOne<ConflictRow>(
      `select ${COLUMNS} from sync_conflicts
        where table_name = $1 and row_id = $2 and resolved_at is null`,
      [table, rowId],
    );
    if (!row) return null;
    const version =
      remoteVersion ?? (typeof remote.row_version === "number" ? remote.row_version : null);

    const { merged, conflicts } = mergeRows(row.base, row.local, remote);
    if (conflicts.length === 0) {
      await this.write(table, rowId, merged, remote, version);
      await this.resolve(row.id);
      return merged;
    }
    await this.sql.exec(
      "update sync_conflicts set remote = $1::jsonb, fields = $2::jsonb, server_version = $3 where id = $4",
      [JSON.stringify(remote), JSON.stringify(conflicts), version, row.id],
    );
    return null;
  }

  /** The decided row, stored locally and owed to the server unless it already holds it. */
  private async write(
    table: string,
    rowId: string,
    chosen: Row,
    remote: Row,
    version: number | null,
  ): Promise<void> {
    const outbox = new Outbox(this.sql);
    await outbox.dropRow(table, rowId);
    // Local may still hold this device's side; the server hears only of a change.
    await this.applyRemote(table, chosen);
    if (sameRow(chosen, remote)) return;
    await outbox.append({
      table,
      rowId,
      op: "update",
      payload: chosen,
      basePayload: remote,
      baseVersion: version,
    });
  }

  async openConflicts(): Promise<OpenConflict[]> {
    const rows = await this.sql.query<ConflictRow>(
      `select ${COLUMNS} from sync_conflicts where resolved_at is null order by created_at`,
    );
    return rows.map((row) => ({
      id: row.id,
      table: row.table_name,
      rowId: row.row_id,
      base: row.base,
      local: row.local,
      remote: row.remote,
      fields: row.fields ?? [],
      serverVersion: row.server_version,
      createdAt: row.created_at,
    }));
  }

  /**
   * Settled the way the reader chose, field by field.
   *
   * A field they kept is a new edit on top of the server's row, not a rewind:
   * it is written locally and queued as an op based on the server's version,
   * so the other device sees a decision rather than a silent revert. Fields
   * they left alone keep the server's value, which is already what is stored.
   */
  async resolveWith(
    id: string,
    picks: Record<string, "local" | "remote">,
    overrides?: Record<string, unknown>,
  ): Promise<void> {
    const row = await this.sql.queryOne<ConflictRow>(
      `select ${COLUMNS} from sync_conflicts where id = $1 and resolved_at is null`,
      [id],
    );
    if (!row) return;
    const remote = row.remote;
    // Nothing to decide against until the server's row has arrived.
    if (!remote) return;

    // Start from the merge, so a field only this device changed survives the pick.
    const chosen: Row = { ...mergeRows(row.base, row.local, remote).merged };
    for (const [field, side] of Object.entries(picks)) {
      if (side === "local") chosen[field] = row.local[field];
    }
    if (overrides) {
      for (const [field, val] of Object.entries(overrides)) {
        chosen[field] = val;
      }
    }

    await this.write(row.table_name, row.row_id, chosen, remote, row.server_version);
    await this.resolve(id);
  }

  /** Settled, whichever way the reader went. Kept, so the record is auditable. */
  async resolve(id: string): Promise<void> {
    await this.sql.exec("update sync_conflicts set resolved_at = now() where id = $1", [id]);
  }
}

function sameRow(a: Row, b: Row): boolean {
  return Object.keys({ ...a, ...b }).every(
    (k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null),
  );
}
