import { mergeRows, sameValue, type FieldConflict, type Row } from "./merge";
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

/**
 * `edit`: both sides edited the row. `deleted_remote`: deleted elsewhere while
 * this device edited it; the row stays here until the reader decides.
 * `deleted_local`: deleted here while another device edited it; the delete waits.
 */
export type ConflictKind = "edit" | "deleted_remote" | "deleted_local";

export interface OpenConflict {
  id: string;
  kind: ConflictKind;
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
  kind: ConflictKind;
  table_name: string;
  row_id: string;
  base: Row;
  local: Row;
  remote: Row | null;
  fields: FieldConflict[] | null;
  server_version: number | null;
  created_at: string;
}

const COLUMNS = "id, kind, table_name, row_id, base, local, remote, fields, server_version, created_at";

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
      `insert into sync_conflicts (table_name, row_id, base, local, server_version, kind)
       values ($1, $2, $3::jsonb, $4::jsonb, $5, 'edit')
       on conflict (table_name, row_id) where resolved_at is null
       do update set local = excluded.local, server_version = excluded.server_version, kind = 'edit'`,
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

  /** The open conflict on a row, if any. */
  async find(table: string, rowId: string): Promise<{ id: string; kind: ConflictKind } | null> {
    return this.sql.queryOne<{ id: string; kind: ConflictKind }>(
      "select id::text as id, kind from sync_conflicts where table_name = $1 and row_id = $2 and resolved_at is null",
      [table, rowId],
    );
  }

  /**
   * Deleted elsewhere while this device still owes edits for it, or rows that
   * point at it. The local row stays; the reader decides whether it goes.
   */
  async openDeletedRemote(table: string, rowId: string): Promise<void> {
    const outbox = new Outbox(this.sql);
    const owed = (await outbox.forRow(table, rowId)).filter((op) => op.op !== "delete");
    const stored = await this.sql.queryOne<{ row: Row }>(
      `select sync_payload($1, to_jsonb(t)) as row from public.${quoteIdent(table)} t where id = $2`,
      [table, rowId],
    );
    const mine = stored?.row ?? owed[owed.length - 1]?.payload;
    if (!mine) return;
    await this.sql.exec(
      `insert into sync_conflicts (table_name, row_id, base, local, remote, fields, server_version, kind)
       values ($1, $2, $3::jsonb, $4::jsonb, null, '[]'::jsonb, null, 'deleted_remote')
       on conflict (table_name, row_id) where resolved_at is null
       do update set local = excluded.local, remote = null, fields = '[]'::jsonb,
                     server_version = null, kind = 'deleted_remote'`,
      [table, rowId, JSON.stringify(owed[0]?.basePayload ?? {}), JSON.stringify(mine)],
    );
    await outbox.dropRow(table, rowId);
  }

  /**
   * Deleted here while another device edited it. The row stays deleted here and
   * the delete waits; the reader decides whether it stands.
   */
  async openDeletedLocal(table: string, rowId: string, remote: Row, serverVersion: number | null): Promise<void> {
    const outbox = new Outbox(this.sql);
    const ops = await outbox.forRow(table, rowId);
    await this.sql.exec(
      `insert into sync_conflicts (table_name, row_id, base, local, remote, fields, server_version, kind)
       values ($1, $2, $3::jsonb, '{}'::jsonb, $4::jsonb, '[]'::jsonb, $5, 'deleted_local')
       on conflict (table_name, row_id) where resolved_at is null
       do update set local = '{}'::jsonb, remote = excluded.remote, fields = '[]'::jsonb,
                     server_version = excluded.server_version, kind = 'deleted_local'`,
      [table, rowId, JSON.stringify(ops[0]?.basePayload ?? {}), JSON.stringify(remote), serverVersion],
    );
    await outbox.dropRow(table, rowId);
  }

  /**
   * A local row folded into the server's copy of the same thing: both sides
   * made it, so every field they set differently is the reader's call.
   */
  async openFolded(table: string, rowId: string, local: Row, remote: Row, serverVersion: number | null): Promise<void> {
    await this.sql.exec(
      `insert into sync_conflicts (table_name, row_id, base, local, server_version, kind)
       values ($1, $2, '{}'::jsonb, $3::jsonb, $4, 'edit')
       on conflict (table_name, row_id) where resolved_at is null
       do update set local = excluded.local, server_version = excluded.server_version, kind = 'edit'`,
      [table, rowId, JSON.stringify(local), serverVersion],
    );
    await this.settle(table, rowId, remote, serverVersion);
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
    if (row.kind === "deleted_local") {
      // The newest cloud copy is what "restore" brings back; local stays deleted.
      await this.sql.exec("update sync_conflicts set remote = $1::jsonb, server_version = $2 where id = $3", [
        JSON.stringify(remote),
        version,
        row.id,
      ]);
      return null;
    }
    // Deleted elsewhere, then back (restored there): an ordinary edit conflict again.
    if (row.kind === "deleted_remote") {
      await this.sql.exec("update sync_conflicts set kind = 'edit' where id = $1", [row.id]);
    }

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

  /** Re-merge open conflicts, so ones an older, stricter merge raised settle themselves. */
  async recheck(): Promise<void> {
    const rows = await this.sql.query<ConflictRow>(
      `select ${COLUMNS} from sync_conflicts where resolved_at is null and remote is not null and kind = 'edit'`,
    );
    for (const row of rows) {
      await this.settle(row.table_name, row.row_id, row.remote!, row.server_version);
    }
  }

  async openConflicts(): Promise<OpenConflict[]> {
    const rows = await this.sql.query<ConflictRow>(
      `select ${COLUMNS} from sync_conflicts where resolved_at is null order by created_at`,
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind ?? "edit",
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
    if (!row || row.kind !== "edit") return;
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

  /**
   * A delete conflict, settled the way the reader chose. `keep` keeps the row:
   * sent again whole when deleted elsewhere, brought back from the cloud copy
   * when deleted here. `delete` lets the delete stand on both sides.
   */
  async resolveDeletion(id: string, choice: "keep" | "delete"): Promise<void> {
    const row = await this.sql.queryOne<ConflictRow>(
      `select ${COLUMNS} from sync_conflicts where id = $1 and resolved_at is null`,
      [id],
    );
    if (!row || row.kind === "edit") return;
    const outbox = new Outbox(this.sql);
    const table = row.table_name;
    const rowId = row.row_id;
    if (row.kind === "deleted_remote") {
      if (choice === "keep") {
        const payload = { ...row.local, id: rowId };
        await outbox.dropRow(table, rowId);
        await this.applyRemote(table, payload);
        // The server takes a tombstoned id again (sync_untombstone, 0134).
        await outbox.append({ table, rowId, op: "insert", payload });
      } else {
        await this.sql.exec("select sync_accept_delete($1, $2::uuid)", [table, rowId]);
      }
    } else if (choice === "delete") {
      await outbox.dropRow(table, rowId);
      await outbox.append({ table, rowId, op: "delete", payload: {}, baseVersion: row.server_version });
    } else if (row.remote) {
      await this.applyRemote(table, row.remote);
    }
    await this.resolve(id);
  }

  /** Settled, whichever way the reader went. Kept, so the record is auditable. */
  async resolve(id: string): Promise<void> {
    await this.sql.exec("update sync_conflicts set resolved_at = now() where id = $1", [id]);
  }
}

function sameRow(a: Row, b: Row): boolean {
  return Object.keys({ ...a, ...b }).every((k) => sameValue(a[k] ?? null, b[k] ?? null));
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** A bulk "mine"/"cloud" pick as a delete conflict's choice: mine keeps what this device did. */
export function deletionFor(kind: Exclude<ConflictKind, "edit">, side: "local" | "remote"): "keep" | "delete" {
  const mine = kind === "deleted_remote" ? "keep" : "delete";
  if (side === "local") return mine;
  return mine === "keep" ? "delete" : "keep";
}
