import { Adoption, type AdoptionRequest, type AdoptionResult } from "./adoption";
import { ConflictStore } from "./conflicts";
import { Outbox, type SqlRunner } from "./outbox";
import { OutboxPump, type PumpResult } from "./pump";
import { Puller, type PullResult } from "./puller";
import { SyncStateStore } from "./sync-state";
import type { SyncTransport } from "./sync-ports";

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
    sql: SqlRunner,
    transport: SyncTransport,
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
    await this.pump.run();
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
    const pushed = await this.pump.run();
    // Nothing to pull if the network just refused the push — the pull would
    // only fail the same way, and a thrown pull loses the push's report.
    if (pushed.stoppedBecause === "offline") {
      return { pushed, pulled: { applied: 0, watermark: (await this.state.read()).watermark, more: false } };
    }
    return { pushed, pulled: await this.puller.pull() };
  }
}
