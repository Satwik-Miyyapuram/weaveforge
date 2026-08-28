/**
 * Screening decisions, agreement between reviewers, and PRISMA counts.
 *
 * A systematic review screens the same candidate twice: once on title and
 * abstract, and again on the full text for whatever survived. Two people do it
 * independently and then compare, because a screen one person can do alone is a
 * screen nobody can check.
 *
 * Three rules shape everything here. A decision belongs to a reviewer and a
 * stage, so two people disagreeing is a normal state rather than a conflict to
 * resolve by overwriting. A decision belongs to the membership row rather than
 * to the paper, because the same paper screened for two reviews is two
 * questions with two answers. And every count below is derived: a stored total
 * is a total that drifts the first time somebody changes a decision.
 *
 * Pure -- no I/O, and no clock of its own. The caller supplies both.
 */

import type { Identifiable } from "../../../shared/repository.js";

/** The two passes of a screen. Full text is only reached by surviving the first. */
export type ScreeningStage = "title_abstract" | "full_text";

export const SCREENING_STAGES: readonly ScreeningStage[] = ["title_abstract", "full_text"];

/**
 * What one reviewer decided.
 *
 * `unsure` is a real answer rather than an absent one: "I could not tell from
 * the abstract" is the reason full-text screening exists, and collapsing it
 * into `excluded` drops the paper silently.
 */
export type ScreeningState = "included" | "excluded" | "unsure";

export const SCREENING_STATES: readonly ScreeningState[] = ["included", "excluded", "unsure"];

export interface ScreeningDecision extends Identifiable {
  id: string;
  /** The `reading_list_items` row -- this paper, in this review. */
  itemId: string;
  reviewerId: string;
  stage: ScreeningStage;
  state: ScreeningState;
  /** Why. Expected for an exclusion at full text; a PRISMA box asks for it. */
  reason?: string;
  decidedAt: string;
}

export class ScreeningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreeningError";
  }
}

/**
 * The decision a reviewer is about to record, checked against what came before.
 *
 * The one rule worth enforcing: a full-text decision on something the same
 * reviewer already excluded on the abstract is a mistake, not a change of mind
 * -- the change of mind is to revise the earlier decision, which leaves a
 * coherent trail. Everything else is allowed, including reversing yourself at
 * the same stage, because reviewers do that and the record should show it.
 */
export function checkDecision(
  next: Pick<ScreeningDecision, "itemId" | "reviewerId" | "stage" | "state">,
  existing: readonly ScreeningDecision[],
): void {
  if (!SCREENING_STATES.includes(next.state)) {
    throw new ScreeningError(`'${String(next.state)}' is not a screening decision.`);
  }
  if (next.stage !== "full_text") return;

  const earlier = existing.find(
    (decision) =>
      decision.itemId === next.itemId &&
      decision.reviewerId === next.reviewerId &&
      decision.stage === "title_abstract",
  );
  if (!earlier) {
    throw new ScreeningError("Screen the title and abstract before the full text.");
  }
  if (earlier.state === "excluded") {
    throw new ScreeningError(
      "You excluded this on the abstract. Revise that decision rather than screening the full text.",
    );
  }
}

/** The latest decision each reviewer recorded for one item, one per reviewer. */
export function latestByReviewer(
  decisions: readonly ScreeningDecision[],
  itemId: string,
  stage: ScreeningStage,
): Map<string, ScreeningDecision> {
  const latest = new Map<string, ScreeningDecision>();
  for (const decision of decisions) {
    if (decision.itemId !== itemId || decision.stage !== stage) continue;
    const held = latest.get(decision.reviewerId);
    if (!held || held.decidedAt <= decision.decidedAt) latest.set(decision.reviewerId, decision);
  }
  return latest;
}

export interface ItemVerdict {
  itemId: string;
  stage: ScreeningStage;
  /** What the reviewers agree on, or null while they do not. */
  state: ScreeningState | null;
  /** True when reviewers recorded different states. */
  conflict: boolean;
  /** How many reviewers have answered at all. */
  answered: number;
}

/**
 * Where one item stands at one stage.
 *
 * A single reviewer's answer stands on its own -- most reviews are one person,
 * and a screen that reported "undecided" until a second reviewer appeared would
 * be useless to them. Two who disagree is a conflict, and a conflict has no
 * state until somebody resolves it: guessing here is how a paper leaves a
 * review that never noticed it had.
 */
export function verdictFor(
  decisions: readonly ScreeningDecision[],
  itemId: string,
  stage: ScreeningStage,
): ItemVerdict {
  const latest = [...latestByReviewer(decisions, itemId, stage).values()];
  const states = new Set(latest.map((decision) => decision.state));
  const only = [...states][0];
  return {
    itemId,
    stage,
    state: states.size === 1 && only ? only : null,
    conflict: states.size > 1,
    answered: latest.length,
  };
}

export interface Agreement {
  /** The two reviewers compared, in the order given. */
  reviewers: [string, string];
  /** Items both of them screened at this stage. */
  compared: number;
  /** Items they answered identically. */
  agreed: number;
  /** `agreed / compared`, or null when they have screened nothing in common. */
  proportion: number | null;
  /**
   * Cohen's kappa: agreement past what their individual rates would produce by
   * chance. Null when there is nothing to compare, and null when chance
   * agreement is total -- both said "included" to everything, where kappa is
   * `0/0` and reporting 0 would read as "they never agree".
   */
  kappa: number | null;
}

type Pair = { a: ScreeningState; b: ScreeningState };

/**
 * How much two reviewers agree, and how much of that is not luck.
 *
 * Percent agreement alone flatters a screen where almost everything is
 * excluded, which is most screens: two people rejecting 95% of a search agree
 * 95% of the time by saying no. Kappa is the number a methods section reports
 * for exactly that reason, so it is computed here rather than left to whoever
 * writes the paper.
 */
export function agreementBetween(
  decisions: readonly ScreeningDecision[],
  reviewers: [string, string],
  stage: ScreeningStage,
): Agreement {
  const [first, second] = reviewers;
  const pairs: Pair[] = [];
  for (const itemId of new Set(decisions.map((decision) => decision.itemId))) {
    const latest = latestByReviewer(decisions, itemId, stage);
    const a = latest.get(first)?.state;
    const b = latest.get(second)?.state;
    if (a && b) pairs.push({ a, b });
  }

  const compared = pairs.length;
  const agreed = pairs.filter((pair) => pair.a === pair.b).length;
  if (!compared) return { reviewers, compared: 0, agreed: 0, proportion: null, kappa: null };

  const observed = agreed / compared;
  const rateOf = (side: "a" | "b", state: ScreeningState) =>
    pairs.filter((pair) => pair[side] === state).length / compared;
  let expected = 0;
  for (const state of SCREENING_STATES) expected += rateOf("a", state) * rateOf("b", state);

  return {
    reviewers,
    compared,
    agreed,
    proportion: observed,
    kappa: expected >= 1 ? null : (observed - expected) / (1 - expected),
  };
}

export interface PrismaCounts {
  /** Everything the searches turned up, before anything was thrown away. */
  identified: number;
  /** Records removed as duplicates of another record. */
  duplicates: number;
  /** What was left to screen on title and abstract. */
  screened: number;
  excludedAtScreening: number;
  /** Full texts sought and assessed. */
  eligible: number;
  excludedAtFullText: number;
  included: number;
  /** Items nobody has decided yet. Not a PRISMA box -- a warning about one. */
  undecided: number;
  /** Items where reviewers disagree. Also not a box, and also worth saying. */
  conflicts: number;
}

export interface ScreeningItem {
  /** The `reading_list_items` row id. */
  id: string;
  /** Marked as a duplicate of another record in the same list. */
  duplicateOfItemId?: string;
}

/**
 * The PRISMA numbers, derived from the decisions every time they are asked for.
 *
 * Never stored. A diagram whose boxes were written down once disagrees with the
 * data the first time a reviewer changes their mind, and the disagreement is
 * invisible -- both numbers look equally authoritative.
 */
export function prismaCounts(
  items: readonly ScreeningItem[],
  decisions: readonly ScreeningDecision[],
): PrismaCounts {
  const duplicates = items.filter((item) => item.duplicateOfItemId).length;
  const screenedItems = items.filter((item) => !item.duplicateOfItemId);

  let excludedAtScreening = 0;
  let eligible = 0;
  let excludedAtFullText = 0;
  let included = 0;
  let undecided = 0;
  let conflicts = 0;

  for (const item of screenedItems) {
    const abstract = verdictFor(decisions, item.id, "title_abstract");
    if (abstract.conflict) conflicts += 1;
    if (!abstract.answered) {
      undecided += 1;
      continue;
    }
    if (abstract.state === "excluded") {
      excludedAtScreening += 1;
      continue;
    }
    // `unsure` and an unresolved conflict both go on to the full text, which is
    // what full-text screening is for: the abstract could not answer it.
    eligible += 1;

    const full = verdictFor(decisions, item.id, "full_text");
    if (full.conflict) conflicts += 1;
    if (!full.answered) undecided += 1;
    else if (full.state === "included") included += 1;
    else if (full.state === "excluded") excludedAtFullText += 1;
  }

  return {
    identified: items.length,
    duplicates,
    screened: screenedItems.length,
    excludedAtScreening,
    eligible,
    excludedAtFullText,
    included,
    undecided,
    conflicts,
  };
}

/** Why full texts were excluded, most common first -- a PRISMA box asks by name. */
export function exclusionReasons(
  decisions: readonly ScreeningDecision[],
  stage: ScreeningStage = "full_text",
): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const itemId of new Set(decisions.map((decision) => decision.itemId))) {
    if (verdictFor(decisions, itemId, stage).state !== "excluded") continue;
    // One reason per item, not one per reviewer: two people excluding the same
    // paper for the same reason is one exclusion, and the box counts papers.
    for (const decision of latestByReviewer(decisions, itemId, stage).values()) {
      const reason = decision.reason?.trim();
      if (reason) counts.set(reason, (counts.get(reason) ?? 0) + 1);
      break;
    }
  }
  return [...counts]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
