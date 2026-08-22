import { mergeRows, type FieldConflict, type Row } from "./merge";
import type { OutboxEntry, SqlRunner } from "./outbox";

/**
 * The disagreements the device could not settle, and how they get settled.
 *
 * A conflict is opened by the pump, which learns only that the server has a
 * newer version, and completed by the puller, which is what actually carries
 * the server's row. In between it holds two of the three sides, which is the
 * honest state: something disagrees, and we have not yet heard what.
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
   * The pump's half: this op was refused as stale.
   *
   * An insert has no base, so there is nothing to merge against and nothing
   * useful to record — the row already exists on the server and the puller will
   * bring it.
   */
  async open(entry: OutboxEntry, serverVersion: number): Promise<void> {
    if (!entry.basePayload) return;
    await this.sql.exec(
      `insert into sync_conflicts (table_name, row_id, base, local, server_version)
       values ($1, $2, $3::jsonb, $4::jsonb, $5)
       on conflict (table_name, row_id) where resolved_at is null do nothing`,
      [
        entry.table,
        entry.rowId,
        JSON.stringify(entry.basePayload),
        JSON.stringify(entry.payload),
        serverVersion,
      ],
    );
  }

  /**
   * The puller's half: here is what the server actually says.
   *
   * Returns the merged row when the two sides turn out to be compatible, so the
   * caller can write it and be done. A real disagreement stays open, and the
   * server's row stands locally until the reader chooses — a device showing its
   * own unsent version would be showing something nobody else can see.
   */
  async settle(table: string, rowId: string, remote: Row): Promise<Row | null> {
    const row = await this.sql.queryOne<ConflictRow>(
      `select ${COLUMNS} from sync_conflicts
        where table_name = $1 and row_id = $2 and resolved_at is null`,
      [table, rowId],
    );
    if (!row) return null;

    const { merged, conflicts } = mergeRows(row.base, row.local, remote);
    if (conflicts.length === 0) {
      await this.resolve(row.id);
      return merged;
    }
    await this.sql.exec(
      "update sync_conflicts set remote = $1::jsonb, fields = $2::jsonb where id = $3",
      [JSON.stringify(remote), JSON.stringify(conflicts), row.id],
    );
    return null;
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

  /** Settled, whichever way the reader went. Kept, so the record is auditable. */
  async resolve(id: string): Promise<void> {
    await this.sql.exec("update sync_conflicts set resolved_at = now() where id = $1", [id]);
  }
}
