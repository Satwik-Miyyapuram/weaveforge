/**
 * Where screening decisions are kept.
 *
 * Read by item rather than by list: the rows belong to membership, and a
 * repository that took a list id would have to know how membership is joined,
 * which is the list repository's business and not this one's.
 */

import type { ScreeningDecision } from "./screening.js";

export interface IScreeningRepository {
  /** Every decision recorded against these items, by any reviewer, at any stage. */
  listForItems(itemIds: readonly string[]): Promise<ScreeningDecision[]>;
  /**
   * Record a decision, replacing this reviewer's own answer at this stage.
   *
   * An upsert rather than an insert because changing your mind is a normal part
   * of screening -- and because the alternative, a second row, would make
   * "what did they decide" a question with two answers.
   */
  record(decision: ScreeningDecision): Promise<void>;
  remove(id: string): Promise<void>;
}
