/**
 * Screening rules (Rust `reading_lists::screening`), re-exported from index.ts. Each function
 * keeps the signature of packages/core/src/features/reading-lists/domain/screening.ts.
 * Decision lists cross as JSON text: one copy, not a boundary call per field.
 */
import {
  agreementBetween as rawAgreementBetween,
  exclusionReasons as rawExclusionReasons,
  latestByReviewerList as rawLatestByReviewerList,
  prismaCounts as rawPrismaCounts,
  reviewers as rawReviewers,
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
  ScreeningDecisionRow,
  ScreeningItem,
  ScreeningStage,
} from "./bindings.js";

export {
  screeningDecisionFromRow,
  screeningDecisionToRow,
} from "../pkg/wf_wasm.js";

/** Throws `ScreeningError` when `next` may not be recorded after `existing`. */
export function checkDecision(
  next: Pick<ScreeningDecision, "itemId" | "reviewerId" | "stage" | "state">,
  existing: readonly ScreeningDecision[],
): void {
  const draft = { ...next, stage: String(next.stage), state: String(next.state) };
  const message = rawScreeningDecisionError(draft, JSON.stringify(existing));
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
  return rawScreeningDecisionError(next, JSON.stringify(existing)) ?? null;
}

/** `latestByReviewer` as a list, one decision per reviewer. */
export function latestByReviewerList(
  decisions: readonly ScreeningDecision[],
  itemId: string,
  stage: ScreeningStage,
): ScreeningDecision[] {
  return rawLatestByReviewerList(JSON.stringify(decisions), itemId, stage) as ScreeningDecision[];
}

/** The latest decision each reviewer recorded for one item, one per reviewer. */
export function latestByReviewer(
  decisions: readonly ScreeningDecision[],
  itemId: string,
  stage: ScreeningStage,
): Map<string, ScreeningDecision> {
  const latest = rawLatestByReviewerList(JSON.stringify(decisions), itemId, stage) as ScreeningDecision[];
  return new Map(latest.map((decision) => [decision.reviewerId, decision]));
}

/** Where one item stands at one stage. */
export function verdictFor(
  decisions: readonly ScreeningDecision[],
  itemId: string,
  stage: ScreeningStage,
): ItemVerdict {
  return rawVerdictFor(JSON.stringify(decisions), itemId, stage) as ItemVerdict;
}

/** Percent agreement and Cohen's kappa for two reviewers at one stage. */
export function agreementBetween(
  decisions: readonly ScreeningDecision[],
  reviewers: [string, string],
  stage: ScreeningStage,
): Agreement {
  return rawAgreementBetween(JSON.stringify(decisions), reviewers, stage) as Agreement;
}

/** The PRISMA numbers, derived from the decisions every time they are asked for. */
export function prismaCounts(items: readonly ScreeningItem[], decisions: readonly ScreeningDecision[]): PrismaCounts {
  return rawPrismaCounts(JSON.stringify(items), JSON.stringify(decisions)) as PrismaCounts;
}

/** Everyone who recorded a decision: distinct reviewer ids, sorted in UTF-16 order. */
export function reviewers(decisions: readonly ScreeningDecision[]): string[] {
  return rawReviewers(JSON.stringify(decisions)) as string[];
}

/** Why items were excluded at `stage`, most common first. */
export function exclusionReasons(
  decisions: readonly ScreeningDecision[],
  stage: ScreeningStage = "full_text",
): ExclusionReasonCount[] {
  return rawExclusionReasons(JSON.stringify(decisions), stage) as ExclusionReasonCount[];
}

export type { ScreeningDecisionRow } from "./bindings.js";

