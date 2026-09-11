import type { IAiAuditStore, IAiPaperNoteAppender, IAiProposalStore } from "../domain/ai-write-proposal.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../shared/errors.js";

export class ConfirmAiProposalUseCase {
  constructor(
    private readonly deps: {
      proposals: IAiProposalStore;
      paperNotes: IAiPaperNoteAppender;
      audit: IAiAuditStore;
      ids: { newId(): string };
      clock: { nowIso(): string };
    },
  ) {}

  async execute(proposalId: string): Promise<"accepted" | "conflicted"> {
    const proposal = await this.deps.proposals.getById(proposalId);
    // Typed rather than bare `Error`: missing → 404, already decided → 409,
    // an unsupported kind is a bad request → 400 (review-2 F5).
    if (!proposal) throw new NotFoundError("AI proposal not found");
    if (proposal.status !== "pending") throw new ConflictError("AI proposal is no longer pending");
    if (proposal.kind !== "append_paper_note") {
      throw new ValidationError("Unsupported AI proposal kind");
    }
    const result = await this.deps.paperNotes.appendPaperNote({
      paperId: proposal.resourceId, addition: proposal.content, expectedRevision: proposal.expectedRevision,
    });
    const status = result === "appended" ? "accepted" : "conflicted";
    await this.deps.proposals.save({ ...proposal, status });
    await this.deps.audit.save({ id: this.deps.ids.newId(), proposalId, action: status, createdAt: this.deps.clock.nowIso() });
    return status;
  }
}
