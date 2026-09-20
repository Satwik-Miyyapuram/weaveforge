import type { Clock } from "../../../shared/clock.js";
import type { IPaperRepository } from "../../papers/domain/paper-repository.js";
import { appendPaperNote, type IAiPaperNoteAppender } from "../domain/ai-write-proposal.js";

/**
 * Append a note to a paper's summary, refusing to clobber a paper that moved on.
 *
 * This lived in the composition root as an object literal built for the AI
 * executor factory, which meant the one place that decides whether an approved
 * proposal still applies was also the one place that could not be tested without
 * wiring the whole container. The port it satisfies already existed.
 *
 * The method is named `appendPaperNote` rather than `execute` because that *is*
 * the port — `IAiPaperNoteAppender` — and the factory takes an implementation of
 * it. Matching the name is what lets the container hand this object straight
 * over instead of wrapping it in another object literal, which is the shape the
 * duplication came from.
 */
export class AppendPaperNoteUseCase implements IAiPaperNoteAppender {
  constructor(
    private readonly deps: {
      /** Only the two methods this needs: one read, one write. */
      papers: Pick<IPaperRepository, "getById" | "save">;
      clock: Clock;
    },
  ) {}

  async appendPaperNote(input: {
    paperId: string;
    addition: string;
    expectedRevision?: string;
  }): Promise<"appended" | "conflicted"> {
    const paper = await this.deps.papers.getById(input.paperId);
    if (!proposalApplies(paper, input.expectedRevision)) return "conflicted";

    await this.deps.papers.save({
      ...paper,
      summary: appendPaperNote(paper.summary, input.addition),
      updatedAt: this.deps.clock.nowIso(),
    });
    return "appended";
  }
}

/**
 * Whether a proposal's expectation still holds for the stored row.
 *
 * The same comparison was written out three times — here, and twice in the
 * proposal executors — and the copies are what make it dangerous: each is a
 * write that either checks the revision or silently does not. `expectedRevision`
 * is optional, so the mistake has a shape, and it is not the obvious one:
 * comparing `stored.updatedAt !== expectedRevision` without first asking whether
 * there *is* an expectation makes every proposal without one an unconditional
 * conflict.
 *
 * A generic predicate rather than a boolean, because the callers need the row
 * afterwards: `if (!proposalApplies(paper, rev)) return "conflicted";` leaves
 * `paper` narrowed and non-null, and keeps the caller's own row type instead of
 * reducing it to the one field this looks at.
 *
 * A missing row does not apply. The proposal names something that is gone, and
 * applying it would have to invent it.
 *
 * An empty expectation counts as no expectation, which is what all three copies
 * did. That is preserved deliberately rather than tidied: changing it would
 * start refusing proposals that were previously applied, and no caller has ever
 * meant `""` as a revision.
 */
export function proposalApplies<T extends { updatedAt: string }>(
  stored: T | null,
  expectedRevision?: string,
): stored is T {
  if (!stored) return false;
  return expectedRevision ? stored.updatedAt === expectedRevision : true;
}
