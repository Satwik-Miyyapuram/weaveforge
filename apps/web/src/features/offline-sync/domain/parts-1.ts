import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import { readyCore } from "@/lib/rust-core";
import type { FieldConflict, Row } from "@weaveforge/core";
import { Outbox, type SqlRunner } from "./parts-2";
import { SyncStateStore } from "./parts-3";

// --- adoption ---
/**
 * Turning sync on for the first time: this device's work becomes an account's.
 *
 * It happens once in a device's life. After it, both sides share a server
 * history and every write goes through the normal machinery — versioned
 * updates, tombstones, the watermark. Before it, there is no shared history at
 * all, which is why the collision rule below is a rename rather than a merge.
 */

export interface AdoptionRequest {
  accountId: string;
  /** Names the account already holds, so a collision can be spotted. */
  remoteProjectNames: readonly string[];
  /**
   * How the reader knows this machine. It goes in the suffix, because "which
   * laptop was this?" is the question they can actually answer.
   */
  deviceLabel: string;
}

export interface AdoptionResult {
  claimed: number;
  queued: number;
  renamed: readonly { id: string; from: string; to: string }[];
}

export class AlreadyAdoptedError extends Error {
  constructor(readonly accountId: string) {
    super("This device already syncs with an account.");
    this.name = "AlreadyAdoptedError";
  }
}

interface ProjectRow {
  id: string;
  name: string;
}

export class Adoption {
  private readonly state: SyncStateStore;

  constructor(
    private readonly sql: SqlRunner,
    private readonly localUserId: string,
  ) {
    this.state = new SyncStateStore(sql);
  }

  async run(request: AdoptionRequest): Promise<AdoptionResult> {
    const state = await this.state.read();
    // Adopting twice would take rows from the first account and hand them to
    // the second — silently, and with no way back.
    const adopted = readyCore().adoptedAccount(state.accountId ?? undefined);
    if (adopted) throw new AlreadyAdoptedError(adopted);

    const renamed = await this.rename(request.remoteProjectNames, request.deviceLabel);
    const claimed = await this.claim(request.accountId);
    const queued = await this.backfill(request.accountId);
    await this.state.adopt(request.accountId);
    return { claimed, queued, renamed };
  }

  /**
   * Two projects that share a name may be the same work in two states or two
   * unrelated things, and nothing here can tell which. Fusing them interleaves
   * two sets of notes unrecoverably; two projects side by side is a tidy-up the
   * reader can do knowingly. So: keep both, and say which machine this one
   * came from.
   */
  private async rename(
    remoteNames: readonly string[],
    deviceLabel: string,
  ): Promise<AdoptionResult["renamed"]> {
    if (remoteNames.length === 0) return [];
    const local = await this.sql.query<ProjectRow>(
      "select id, name from projects where user_id = $1 and deleted_at is null order by name",
      [this.localUserId],
    );
    // The plan (which project collides, and its new name) is wf-core's; the write is ours.
    const plan = readyCore().planRenames(local, remoteNames, deviceLabel);
    for (const rename of plan) {
      await this.sql.exec("update projects set name = $1 where id = $2", [rename.to, rename.id]);
    }
    return plan;
  }

  private async claim(accountId: string): Promise<number> {
    const row = await this.sql.queryOne<{ sync_claim: number }>(
      "select sync_claim($1, $2) as sync_claim",
      [accountId, this.localUserId],
    );
    return Number(row?.sync_claim ?? 0);
  }

  private async backfill(accountId: string): Promise<number> {
    const row = await this.sql.queryOne<{ sync_backfill: number }>(
      "select sync_backfill($1) as sync_backfill",
      [accountId],
    );
    return Number(row?.sync_backfill ?? 0);
  }
}

// --- conflicts ---
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
    const sides = readyCore().editSides(await outbox.forRow(table, rowId));
    if (!sides) return;
    await this.sql.exec(
      `insert into sync_conflicts (table_name, row_id, base, local, server_version, kind)
       values ($1, $2, $3::jsonb, $4::jsonb, $5, 'edit')
       on conflict (table_name, row_id) where resolved_at is null
       do update set local = excluded.local, server_version = excluded.server_version, kind = 'edit'`,
      [
        table,
        rowId,
        JSON.stringify(sides.base),
        JSON.stringify(sides.local),
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
    const ops = await outbox.forRow(table, rowId);
    const stored = await this.sql.queryOne<{ row: Row }>(
      `select sync_payload($1, to_jsonb(t)) as row from public.${readyCore().quoteIdent(table)} t where id = $2`,
      [table, rowId],
    );
    const sides = readyCore().deletedRemoteSides(ops, stored?.row ?? null);
    if (!sides) return;
    await this.sql.exec(
      `insert into sync_conflicts (table_name, row_id, base, local, remote, fields, server_version, kind)
       values ($1, $2, $3::jsonb, $4::jsonb, null, '[]'::jsonb, null, 'deleted_remote')
       on conflict (table_name, row_id) where resolved_at is null
       do update set local = excluded.local, remote = null, fields = '[]'::jsonb,
                     server_version = null, kind = 'deleted_remote'`,
      [table, rowId, JSON.stringify(sides.base), JSON.stringify(sides.local)],
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
      [table, rowId, JSON.stringify(readyCore().deletedLocalBase(ops)), JSON.stringify(remote), serverVersion],
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
    const plan = readyCore().settleConflictPlan(row.kind, row.base, row.local, remote);
    if (plan.action === "storeRemote") {
      // The newest cloud copy is what "restore" brings back; local stays deleted.
      await this.sql.exec("update sync_conflicts set remote = $1::jsonb, server_version = $2 where id = $3", [
        JSON.stringify(remote),
        version,
        row.id,
      ]);
      return null;
    }
    // Deleted elsewhere, then back (restored there): an ordinary edit conflict again.
    if (plan.action === "merged") {
      if (plan.restore_edit) {
        await this.sql.exec("update sync_conflicts set kind = 'edit' where id = $1", [row.id]);
      }
      await this.write(table, rowId, plan.merged, remote, version);
      await this.resolve(row.id);
      return plan.merged;
    }
    if (plan.action === "open") {
      if (plan.restore_edit) {
        await this.sql.exec("update sync_conflicts set kind = 'edit' where id = $1", [row.id]);
      }
      await this.sql.exec(
        "update sync_conflicts set remote = $1::jsonb, fields = $2::jsonb, server_version = $3 where id = $4",
        [JSON.stringify(remote), JSON.stringify(plan.conflicts), version, row.id],
      );
    }
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
    if (readyCore().sameRow(chosen, remote)) return;
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
    const chosen = readyCore().resolveWithRow(row.base, row.local, remote, picks, overrides);

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
    const action = readyCore().deletionAction(
      row.kind === "deleted_remote" ? "deleted_remote" : "deleted_local",
      choice,
      row.local,
      rowId,
      row.remote,
    );
    switch (action.action) {
      case "resendLocal":
        await outbox.dropRow(table, rowId);
        await this.applyRemote(table, action.payload);
        // The server takes a tombstoned id again (sync_untombstone, 0134).
        await outbox.append({ table, rowId, op: "insert", payload: action.payload });
        break;
      case "acceptRemoteDelete":
        await this.sql.exec("select sync_accept_delete($1, $2::uuid)", [table, rowId]);
        break;
      case "deleteLocally":
        await outbox.dropRow(table, rowId);
        await outbox.append({ table, rowId, op: "delete", payload: {}, baseVersion: row.server_version });
        break;
      case "restoreRemote":
        await this.applyRemote(table, action.remote);
        break;
      case "nothing":
        break;
    }
    await this.resolve(id);
  }

  /** Settled, whichever way the reader went. Kept, so the record is auditable. */
  async resolve(id: string): Promise<void> {
    await this.sql.exec("update sync_conflicts set resolved_at = now() where id = $1", [id]);
  }
}

// --- live-sync ---
export type SyncPhase = "idle" | "syncing" | "offline" | "error" | "needs-adoption";

export interface LiveSyncState {
  phase: SyncPhase;
  enabled: boolean;
  isOnline: boolean;
  accountId: string | null;
  lastSyncAt: number | null;
  conflictsCount: number;
  /** What signing in merged, shown once rather than asked about. */
  lastAdoption: AdoptionResult | null;
}

const defaultState: LiveSyncState = {
  phase: typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "idle",
  enabled: false,
  isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
  accountId: null,
  lastSyncAt: null,
  conflictsCount: 0,
  lastAdoption: null,
};

let currentState: LiveSyncState = { ...defaultState };
const listeners = new Set<(state: LiveSyncState) => void>();
let registeredTrigger: (() => void) | null = null;

export function getLiveSyncState(): LiveSyncState {
  return currentState;
}

export function setLiveSyncState(partial: Partial<LiveSyncState>): void {
  currentState = { ...currentState, ...partial };
  for (const listener of [...listeners]) {
    try {
      listener(currentState);
    } catch (err) {
      // One broken listener must not stop the others hearing the change.
      logToApp({
        level: "warn",
        source: "offline-sync",
        message: "A sync status listener failed",
        detail: formatError(err),
      });
    }
  }
}

export function onLiveSyncChange(listener: (state: LiveSyncState) => void): () => void {
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

export function registerSyncTrigger(trigger: () => void): () => void {
  registeredTrigger = trigger;
  return () => {
    if (registeredTrigger === trigger) {
      registeredTrigger = null;
    }
  };
}

export function requestSync(): void {
  registeredTrigger?.();
}
