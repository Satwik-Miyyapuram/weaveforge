import type { AiProposalExecution, IAiAuditStore, IAiProposalExecutor, IAiProposalStore } from "../domain/ai-write-proposal.js";
import { ConflictError, NotFoundError } from "../../../shared/errors.js";

/** Executes an already-reviewed proposal and records its immutable outcome. */
export class ExecuteAiProposalUseCase {
  constructor(private readonly deps: {
    proposals: IAiProposalStore; audit: IAiAuditStore; executors: Pick<IAiProposalExecutor, "execute">;
    ids: { newId(): string }; clock: { nowIso(): string };
  }) {}

  async execute(proposalId: string): Promise<AiProposalExecution> {
    const proposal = await this.deps.proposals.getById(proposalId);
    // Typed rather than bare `Error`: a missing proposal is a 404 and one that
    // has already been decided is a 409 (review-2 F5).
    if (!proposal) throw new NotFoundError("AI proposal not found");
    if (proposal.status !== "pending") throw new ConflictError("AI proposal is no longer pending");
    const status = await this.deps.executors.execute(proposal);
    await this.deps.proposals.save({ ...proposal, status });
    await this.deps.audit.save({ id: this.deps.ids.newId(), proposalId, action: status, createdAt: this.deps.clock.nowIso() });
    return status;
  }
}
