/** Types for screening. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { Identifiable } from "../../../shared/repository.js";
import { ValidationError } from "../../../shared/errors.js";

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

export class ScreeningError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "ScreeningError";
  }
}

/** Each item's latest decision per reviewer, per stage. */
interface LatestIndex {
  get(itemId: string, stage: ScreeningStage): Map<string, ScreeningDecision>;
  /** Items with any decision, in first-seen order. */
  itemIds(): Iterable<string>;
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

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface ScreeningFns {
  /**
 * The decision a reviewer is about to record, checked against what came before.
 *
 * The one rule worth enforcing: a full-text decision on something the same
 * reviewer already excluded on the abstract is a mistake, not a change of mind
 * -- the change of mind is to revise the earlier decision, which leaves a
 * coherent trail. Everything else is allowed, including reversing yourself at
 * the same stage, because reviewers do that and the record should show it.
 */
  checkDecision(next: Pick<ScreeningDecision, "itemId" | "reviewerId" | "stage" | "state">, existing: readonly ScreeningDecision[]): void;
  /** The latest decision each reviewer recorded for one item, one per reviewer. */
  latestByReviewer(decisions: readonly ScreeningDecision[], itemId: string, stage: ScreeningStage): Map<string, ScreeningDecision>;
  /**
 * Where one item stands at one stage.
 *
 * A single reviewer's answer stands on its own -- most reviews are one person,
 * and a screen that reported "undecided" until a second reviewer appeared would
 * be useless to them. Two who disagree is a conflict, and a conflict has no
 * state until somebody resolves it: guessing here is how a paper leaves a
 * review that never noticed it had.
 */
  verdictFor(decisions: readonly ScreeningDecision[], itemId: string, stage: ScreeningStage): ItemVerdict;
  /** Both stages' verdicts for each item, in item order, from one pass over the decisions. */
  verdictsFor(items: readonly { id: string }[], decisions: readonly ScreeningDecision[]): ItemVerdict[];
  /**
 * How much two reviewers agree, and how much of that is not luck.
 *
 * Percent agreement alone flatters a screen where almost everything is
 * excluded, which is most screens: two people rejecting 95% of a search agree
 * 95% of the time by saying no. Kappa is the number a methods section reports
 * for exactly that reason, so it is computed here rather than left to whoever
 * writes the paper.
 */
  agreementBetween(decisions: readonly ScreeningDecision[], reviewers: [string, string], stage: ScreeningStage): Agreement;
  /**
 * The PRISMA numbers, derived from the decisions every time they are asked for.
 *
 * Never stored. A diagram whose boxes were written down once disagrees with the
 * data the first time a reviewer changes their mind, and the disagreement is
 * invisible -- both numbers look equally authoritative.
 */
  prismaCounts(items: readonly ScreeningItem[], decisions: readonly ScreeningDecision[]): PrismaCounts;
  /** Why full texts were excluded, most common first -- a PRISMA box asks by name. */
  exclusionReasons(decisions: readonly ScreeningDecision[], stage?: ScreeningStage): { reason: string; count: number }[];
}
