/**
 * Screening rules (Rust `reading_lists::screening`), re-exported from index.ts. Each function
 * keeps the signature of packages/core/src/features/reading-lists/domain/screening.ts.
 */
import {
  agreementBetween as rawAgreementBetween,
  exclusionReasons as rawExclusionReasons,
  latestByReviewerList as rawLatestByReviewerList,
  prismaCounts as rawPrismaCounts,
  screeningDecisionError as rawScreeningDecisionError,
  verdictFor as rawVerdictFor,
} from "../pkg/wf_wasm.js";
import type {
  Agreement,
  ExclusionReasonCount,
  ItemVerdict,
  PrismaCounts,
  ScreeningDecision,
  ScreeningDecisionDraft,
  ScreeningItem,
  ScreeningStage,
} from "./bindings.js";

/** Throws `ScreeningError` when `next` may not be recorded after `existing`. */
export function checkDecision(
  next: Pick<ScreeningDecision, "itemId" | "reviewerId" | "stage" | "state">,
  existing: readonly ScreeningDecision[],
): void {
  const draft = { ...next, stage: String(next.stage), state: String(next.state) };
  const message = rawScreeningDecisionError(draft, existing);
  if (message != null) {
    const error = new Error(message);
    error.name = "ScreeningError";
    throw error;
  }
}

/** Why `next` may not be recorded after `existing`, or null when it may. */
export function screeningDecisionError(
  next: ScreeningDecisionDraft,
  existing: readonly ScreeningDecision[],
): string | null {
  return rawScreeningDecisionError(next, existing) ?? null;
}

/** `latestByReviewer` as a list, one decision per reviewer. */
export function latestByReviewerList(
  decisions: readonly ScreeningDecision[],
  itemId: string,
  stage: ScreeningStage,
): ScreeningDecision[] {
  return rawLatestByReviewerList(decisions, itemId, stage) as ScreeningDecision[];
}

/** The latest decision each reviewer recorded for one item, one per reviewer. */
export function latestByReviewer(
  decisions: readonly ScreeningDecision[],
  itemId: string,
  stage: ScreeningStage,
): Map<string, ScreeningDecision> {
  const latest = rawLatestByReviewerList(decisions, itemId, stage) as ScreeningDecision[];
  return new Map(latest.map((decision) => [decision.reviewerId, decision]));
}

/** Where one item stands at one stage. */
export function verdictFor(
  decisions: readonly ScreeningDecision[],
  itemId: string,
  stage: ScreeningStage,
): ItemVerdict {
  return rawVerdictFor(decisions, itemId, stage) as ItemVerdict;
}

/** Percent agreement and Cohen's kappa for two reviewers at one stage. */
export function agreementBetween(
  decisions: readonly ScreeningDecision[],
  reviewers: [string, string],
  stage: ScreeningStage,
): Agreement {
  return rawAgreementBetween(decisions, reviewers, stage) as Agreement;
}

/** The PRISMA numbers, derived from the decisions every time they are asked for. */
export function prismaCounts(items: readonly ScreeningItem[], decisions: readonly ScreeningDecision[]): PrismaCounts {
  return rawPrismaCounts(items, decisions) as PrismaCounts;
}

/** Why items were excluded at `stage`, most common first. */
export function exclusionReasons(
  decisions: readonly ScreeningDecision[],
  stage: ScreeningStage = "full_text",
): ExclusionReasonCount[] {
  return rawExclusionReasons(decisions, stage) as ExclusionReasonCount[];
}
