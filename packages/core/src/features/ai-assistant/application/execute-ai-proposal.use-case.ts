import type { AiProposalExecution, IAiAuditStore, IAiProposalExecutor, IAiProposalStore } from "../domain/ai-write-proposal.js";

/** Executes an already-reviewed proposal and records its immutable outcome. */
export class ExecuteAiProposalUseCase {
  constructor(private readonly deps: {
    proposals: IAiProposalStore; audit: IAiAuditStore; executors: Pick<IAiProposalExecutor, "execute">;
    ids: { newId(): string }; clock: { nowIso(): string };
  }) {}

  async execute(proposalId: string): Promise<AiProposalExecution> {
    const proposal = await this.deps.proposals.getById(proposalId);
    if (!proposal) throw new Error("AI proposal not found");
    if (proposal.status !== "pending") throw new Error("AI proposal is no longer pending");
    const status = await this.deps.executors.execute(proposal);
    await this.deps.proposals.save({ ...proposal, status });
    await this.deps.audit.save({ id: this.deps.ids.newId(), proposalId, action: status, createdAt: this.deps.clock.nowIso() });
    return status;
  }
}
