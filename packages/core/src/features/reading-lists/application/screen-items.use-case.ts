/**
 * Recording a screening decision, and reading a screen back.
 *
 * Orchestration only. The rules are in `screening.ts` and the counts are
 * derived there; this coordinates the repository with them, and is the one
 * place that knows a decision needs an id and a timestamp.
 */

import type { Clock, IdGenerator } from "../../../shared/clock.js";
import type { IScreeningRepository } from "../domain/screening-repository.js";
import {
  agreementBetween,
  checkDecision,
  exclusionReasons,
  prismaCounts,
  verdictFor,
  type Agreement,
  type ItemVerdict,
  type PrismaCounts,
  type ScreeningDecision,
  type ScreeningItem,
  type ScreeningStage,
  type ScreeningState,
} from "../domain/screening.js";

export interface ScreenItemsDeps {
  screening: IScreeningRepository;
  clock: Clock;
  ids: IdGenerator;
}

export interface RecordDecisionInput {
  itemId: string;
  reviewerId: string;
  stage: ScreeningStage;
  state: ScreeningState;
  reason?: string;
}

/** A whole screen, read once: the decisions, the counts, and what is unsettled. */
export interface ScreenSummary {
  decisions: ScreeningDecision[];
  counts: PrismaCounts;
  /** One verdict per item per stage, for a table to render without recomputing. */
  verdicts: ItemVerdict[];
  reasons: { reason: string; count: number }[];
  /** Everyone who has recorded a decision, so a caller can offer the comparisons. */
  reviewers: string[];
}

export class ScreenItemsUseCase {
  constructor(private readonly deps: ScreenItemsDeps) {}

  /**
   * Record one decision.
   *
   * The existing decisions are read first because the one rule worth enforcing
   * -- do not screen the full text of something you excluded on the abstract --
   * is about them. Checked here rather than in the database: it is a rule about
   * one reviewer's own trail, and a CHECK constraint cannot see another row.
   */
  async record(input: RecordDecisionInput): Promise<ScreeningDecision> {
    const existing = await this.deps.screening.listForItems([input.itemId]);
    checkDecision(input, existing);

    const decision: ScreeningDecision = {
      id: this.deps.ids.newId(),
      itemId: input.itemId,
      reviewerId: input.reviewerId,
      stage: input.stage,
      state: input.state,
      reason: input.reason?.trim() || undefined,
      decidedAt: this.deps.clock.nowIso(),
    };
    await this.deps.screening.record(decision);
    return decision;
  }

  async summarize(items: readonly ScreeningItem[]): Promise<ScreenSummary> {
    const decisions = await this.deps.screening.listForItems(items.map((item) => item.id));
    const verdicts = items.flatMap((item) => [
      verdictFor(decisions, item.id, "title_abstract"),
      verdictFor(decisions, item.id, "full_text"),
    ]);
    return {
      decisions,
      counts: prismaCounts(items, decisions),
      verdicts,
      reasons: exclusionReasons(decisions),
      reviewers: [...new Set(decisions.map((decision) => decision.reviewerId))].sort(),
    };
  }

  /** How two reviewers compare at one stage. Null when there are not two of them. */
  async agreement(
    items: readonly ScreeningItem[],
    stage: ScreeningStage,
    reviewers?: [string, string],
  ): Promise<Agreement | null> {
    const decisions = await this.deps.screening.listForItems(items.map((item) => item.id));
    const pair =
      reviewers ?? ([...new Set(decisions.map((d) => d.reviewerId))].sort().slice(0, 2) as string[]);
    const [first, second] = pair;
    if (!first || !second) return null;
    return agreementBetween(decisions, [first, second], stage);
  }
}
