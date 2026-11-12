import { readyCore } from "@/lib/rust-core";
import type { ConflictRoute } from "@weaveforge/wasm";
import { Adoption, type AdoptionRequest, type AdoptionResult, ConflictStore } from "./parts-1";
import { Outbox, type OutboxEntry, Puller, type PullResult, type SqlRunner } from "./parts-2";
import type { SendOutcome, SyncTransport } from "./parts";

// --- pump ---
/**
 * Drains the outbox, in order, and stops at the first thing it cannot send.
 *
 * Order is the point. If op 3 fails and op 4 is sent anyway, the server sees an
 * edit to a row it was never told about, and the outcome depends on which
 * request happened to win — so the pump treats a stall as a stall and leaves
 * everything behind it alone.
 *
 * A conflict is not a failure and does not stop the run: it is a fact about one
 * row, merged here when the server's row is at hand, while other rows keep flowing.
 */

export interface PumpResult {
  sent: number;
  /**
   * Ops the server says it has a newer version of, for the merge step.
   *
   * `null` when the transport could not read which version the server holds.
   * That is a different fact from "version 0", and it must stay different all
   * the way to the conflict row: a fabricated 0 comes back as the next
   * attempt's `baseVersion` and produces a guard no row can satisfy.
   */
  conflicts: { entry: OutboxEntry; serverVersion: number | null }[];
  /** Why the run stopped early, if it did. */
  stoppedBecause: "offline" | null;
}

export class OutboxPump {
  constructor(
    private readonly outbox: Outbox,
    private readonly transport: SyncTransport,
    /**
     * Where an op refused as stale is written down. Optional, because the pump
     * is useful before there is anything to merge: a device that has never
     * conflicted needs no conflict store to run.
     */
    private readonly conflicts?: ConflictStore,
  ) {}

  async run(limit = 100): Promise<PumpResult> {
    const result: PumpResult = { sent: 0, conflicts: [], stoppedBecause: null };
    // A row whose op stalled sends nothing more this run: a later op would guard on a stale base.
    const stalled = new Set<string>();
    for (const entry of await this.outbox.pending(limit)) {
      const key = `${entry.table}:${entry.rowId}`;
      if (stalled.has(key)) continue;
      const outcome = await this.attempt(entry);
      const route = readyCore().pumpRoute({
        status: outcome.status,
        opIsDelete: entry.op === "delete",
        hasNewVersion: outcome.status === "accepted" && outcome.newVersion != null,
        awaitingParent: outcome.status === "refused" && !!outcome.awaitingParent,
      });
      if (route.action === "stop") {
        result.stoppedBecause = "offline";
        break;
      }
      if (route.stall) stalled.add(key);
      if (outcome.status === "accepted") {
        await this.outbox.settleSent(entry, outcome.newVersion);
        if (route.ack && outcome.newVersion != null) {
          await this.outbox.ack(entry.table, entry.rowId, outcome.newVersion);
        }
        result.sent += 1;
      } else if (outcome.status === "conflict") {
        result.conflicts.push({ entry, serverVersion: outcome.serverVersion });
        await this.conflict(entry, outcome.serverVersion, outcome.serverRow, outcome.deletedElsewhere);
      } else if (outcome.status === "refused") {
        if (route.action === "wait") await this.outbox.wait(entry.opId, outcome.reason);
        else await this.outbox.fail(entry.opId, outcome.reason);
      }
    }
    return result;
  }

  /**
   * Stale op: merge three ways now when the server's row came back with the
   * refusal, rather than waiting for a pull that may already be past it.
   */
  private async conflict(
    entry: OutboxEntry,
    serverVersion: number | null,
    serverRow: Record<string, unknown> | null | undefined,
    deletedElsewhere?: boolean,
  ): Promise<void> {
    const route = readyCore().conflictRoute({
      op: entry.op,
      serverVersion: serverVersion ?? null,
      serverRow: serverRow === undefined ? "unknown" : serverRow === null ? "absent" : "row",
      deletedElsewhere: deletedElsewhere ?? null,
      hasStore: this.conflicts !== undefined,
    }) as ConflictRoute;
    switch (route.action) {
      case "openDeletedLocal":
        if (this.conflicts && serverRow) {
          await this.conflicts.openDeletedLocal(entry.table, entry.rowId, serverRow, serverVersion);
        }
        return;
      case "dropRow":
        await this.outbox.dropRow(entry.table, entry.rowId);
        return;
      case "fail":
        if (route.rebaseTo != null) await this.outbox.rebase(entry.table, entry.rowId, route.rebaseTo);
        await this.outbox.fail(entry.opId, route.reason);
        return;
      case "openDeletedRemote":
        if (this.conflicts) await this.conflicts.openDeletedRemote(entry.table, entry.rowId);
        return;
      case "reinsert":
        await this.outbox.reinsert(entry.opId, route.reason);
        return;
      case "merge":
        if (!this.conflicts || !serverRow) return;
        await this.conflicts.openFor(entry.table, entry.rowId, serverVersion);
        await this.conflicts.applyRemote(entry.table, serverRow);
        await this.conflicts.settle(entry.table, entry.rowId, serverRow, serverVersion);
        return;
    }
  }

  /**
   * A transport that throws is offline as far as this is concerned.
   *
   * Anything else would need the pump to know which errors mean "no network"
   * across fetch, PostgREST and the shell — and guessing wrong in the other
   * direction burns an attempt on an op that was never actually refused.
   */
  private async attempt(entry: OutboxEntry): Promise<SendOutcome> {
    try {
      return await this.transport.send(entry);
    } catch {
      return { status: "offline" };
    }
  }
}

// --- sync-state ---
/**
 * How far this device has read the server, and whose data it holds.
 *
 * One row, because a device has one answer to both questions. The watermark is
 * the server's own sequence number, never a timestamp: a device whose clock is
 * wrong would otherwise re-read everything or, worse, skip it.
 */

export interface SyncState {
  watermark: number;
  lastPullAt: string | null;
  /** Null until sync is turned on; also the id local rows are re-owned to. */
  accountId: string | null;
}

interface SyncStateRow {
  watermark: string | number;
  last_pull_at: string | null;
  account_id: string | null;
}

export class SyncStateStore {
  constructor(private readonly sql: SqlRunner) {}

  async read(): Promise<SyncState> {
    const row = await this.sql.queryOne<SyncStateRow>(
      "select watermark, last_pull_at, account_id from sync_state",
    );
    // The read decision (null row, bigint text, empty account) is wf-core's `sync_state`.
    return readyCore().syncStateFromRow(row ?? undefined) as SyncState;
  }

  /**
   * Move the watermark forward, and only forward.
   *
   * A pull that answered out of order, or a retry that carried an older
   * high-water mark, must not rewind it — rewinding means re-applying changes
   * the device already has, and for a delete that has since been re-created
   * locally that is data loss rather than wasted work.
   */
  async advance(watermark: number): Promise<void> {
    await this.sql.exec(
      "update sync_state set watermark = greatest(watermark, $1), last_pull_at = now()",
      [watermark],
    );
  }

  /** Record whose account this device now syncs with. */
  async adopt(accountId: string): Promise<void> {
    await this.sql.exec("update sync_state set account_id = $1", [accountId]);
  }
}

// --- sync-engine ---
/**
 * The whole of sync, in the order it has to happen.
 *
 * Turning it on is the only thing in the app that asks for an account, and it
 * asks once. Everything after is one cycle repeated: push what this device did,
 * then read what the account did elsewhere.
 */

/**
 * Whether an account may sync at all, and how much.
 *
 * A port with a permissive default, so the shape exists before there is
 * anything to charge for. Nothing in the UI reads it yet, and nothing should
 * until there is a plan worth selling.
 */
export interface SyncQuota {
  check(accountId: string): Promise<{ allowed: true } | { allowed: false; reason: string }>;
}

/** 200 pages of 500: a hundred thousand rows before the next tick takes over. */
const MAX_PAGES_PER_CYCLE = 200;
/** Push batches per cycle; a backlog drains now rather than 100 ops per tick. */
const MAX_PUSH_ROUNDS = 50;

export const unlimitedSync: SyncQuota = {
  check: async () => ({ allowed: true }),
};

export class SyncRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SyncRefusedError";
  }
}

export interface CycleResult {
  pushed: PumpResult;
  pulled: PullResult;
}

export class SyncEngine {
  private readonly state: SyncStateStore;
  private readonly pump: OutboxPump;
  private readonly puller: Puller;
  private readonly adoption: Adoption;
  readonly conflicts: ConflictStore;

  constructor(
    private readonly sql: SqlRunner,
    private readonly transport: SyncTransport,
    localUserId: string,
    private readonly quota: SyncQuota = unlimitedSync,
  ) {
    this.state = new SyncStateStore(sql);
    this.conflicts = new ConflictStore(sql);
    this.pump = new OutboxPump(new Outbox(sql), transport, this.conflicts);
    this.puller = new Puller(sql, this.state, transport, this.conflicts);
    this.adoption = new Adoption(sql, localUserId);
  }

  /** Has this device been handed to an account yet. */
  async enabled(): Promise<boolean> {
    return (await this.state.read()).accountId !== null;
  }

  /**
   * The opt-in: check, adopt, then deliver.
   *
   * The quota is checked before anything is rewritten, because a refusal after
   * the claim would leave the device owned by an account it cannot sync with.
   */
  async enable(request: AdoptionRequest): Promise<AdoptionResult> {
    const verdict = await this.quota.check(request.accountId);
    if (!verdict.allowed) throw new SyncRefusedError(verdict.reason);
    const result = await this.adoption.run(request);
    // The backfill just queued every row, so there is nothing unsent to look for.
    await this.sql.exec("update sync_state set resend_checked_at = now()");
    await this.push();
    return result;
  }

  /**
   * Push before pull.
   *
   * The other order hides a lost edit: a pulled row overwrites the local one,
   * and the local edit is then sent as if it had been made against what the
   * server already had. Sending first means the server sees the collision and
   * the conflict is reported rather than quietly resolved.
   */
  async cycle(): Promise<CycleResult> {
    await this.conflicts.recheck();
    await this.recoverUnsent();
    const pushed = await this.push();
    // Nothing to pull if the network just refused the push — the pull would
    // only fail the same way, and a thrown pull loses the push's report.
    if (!readyCore().shouldPullAfterPush({ stoppedOffline: pushed.stoppedBecause === "offline" })) {
      return { pushed, pulled: { applied: 0, watermark: (await this.state.read()).watermark, more: false } };
    }
    // Page until caught up, so a device's first download (everything the
    // account has) arrives in one cycle rather than one page per tick. Bounded,
    // so a feed that keeps growing cannot hold the cycle forever.
    let pulled = await this.puller.pull();
    let applied = pulled.applied;
    let pages = 1;
    while (readyCore().shouldFetchNextPage({ more: pulled.more, page: pages, maxPages: MAX_PAGES_PER_CYCLE })) {
      pulled = await this.puller.pull();
      applied += pulled.applied;
      pages += 1;
    }
    return { pushed, pulled: { ...pulled, applied } };
  }

  /**
   * Queue again the rows this device holds and the server never got.
   *
   * Before parents went first, the backfill sent papers ahead of their project;
   * the server refused them, the pump dropped the ops, and the rows stayed here
   * alone. Asked once per device: every live row with no op is checked against
   * the server, and the ones it does not hold go up as inserts, parents first.
   * A server that cannot be read leaves the question open for the next cycle.
   */
  private async recoverUnsent(): Promise<void> {
    if (!this.transport.missingIds) return;
    const state = await this.sql.queryOne<{ account_id: string | null; resend_checked_at: string | null }>(
      "select account_id, resend_checked_at from sync_state",
    );
    if (
      !state ||
      !readyCore().shouldRecoverUnsent({
        hasAccount: !!state.account_id,
        resendChecked: !!state.resend_checked_at,
      })
    )
      return;
    const tables = await this.sql.query<{ t: string }>("select sync_tables_parent_first() as t");
    for (const { t } of tables) {
      const rows = await this.sql.query<{ id: string }>("select sync_unsent_candidates($1, $2) as id", [
        t,
        state.account_id,
      ]);
      if (rows.length === 0) continue;
      const missing = await this.transport.missingIds(t, rows.map((r) => r.id));
      if (missing === null) return;
      if (missing.length === 0) continue;
      await this.sql.exec(
        "select sync_resend($1, array(select jsonb_array_elements_text($2::jsonb)::uuid))",
        [t, JSON.stringify(missing)],
      );
    }
    await this.sql.exec("update sync_state set resend_checked_at = now()");
  }

  private async push(): Promise<PumpResult> {
    const total: PumpResult = { sent: 0, conflicts: [], stoppedBecause: null };
    for (let round = 0; round < MAX_PUSH_ROUNDS; round += 1) {
      const step = await this.pump.run();
      total.sent += step.sent;
      total.conflicts.push(...step.conflicts);
      total.stoppedBecause = step.stoppedBecause;
      if (!readyCore().continuePushRound({ sent: step.sent, stoppedEarly: step.stoppedBecause !== null })) break;
    }
    return total;
  }
}
