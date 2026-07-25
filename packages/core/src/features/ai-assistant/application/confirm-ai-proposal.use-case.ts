import type { IAiAuditStore, IAiPaperNoteAppender, IAiProposalStore } from "../domain/ai-write-proposal.js";

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
    if (!proposal) throw new Error("AI proposal not found");
    if (proposal.status !== "pending") throw new Error("AI proposal is no longer pending");
    if (proposal.kind !== "append_paper_note") throw new Error("Unsupported AI proposal kind");
    const result = await this.deps.paperNotes.appendPaperNote({
      paperId: proposal.resourceId, addition: proposal.content, expectedRevision: proposal.expectedRevision,
    });
    const status = result === "appended" ? "accepted" : "conflicted";
    await this.deps.proposals.save({ ...proposal, status });
    await this.deps.audit.save({ id: this.deps.ids.newId(), proposalId, action: status, createdAt: this.deps.clock.nowIso() });
    return status;
  }
}
