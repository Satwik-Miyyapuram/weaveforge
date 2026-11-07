import type { AiProposalExecution, AiWriteProposal, IAiAuditStore, IAiProposalExecutor, IAiProposalStore } from "../domain/ai-write-proposal.js";
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
    // Claim before running, so two approvals at once run the executor once.
    if (!(await this.deps.proposals.claimPending(proposalId))) {
      throw new ConflictError("AI proposal is no longer pending");
    }
    let status: AiProposalExecution;
    try {
      status = await this.deps.executors.execute(proposal);
    } catch (error) {
      // Nothing was decided: put it back in the queue so it can be retried.
      await this.deps.proposals.save({ ...proposal, status: "pending" });
      throw error;
    }
    // The change has landed. Never back to pending from here: a second
    // approval would apply it twice. Retry the outcome so it does not sit at
    // "executing", and say so plainly if it still cannot be saved.
    try {
      await this.saveOutcome({ ...proposal, status });
    } catch {
      throw new Error("The change was applied, but its review record could not be saved. Do not approve it again.");
    }
    await this.deps.audit.save({ id: this.deps.ids.newId(), proposalId, action: status, createdAt: this.deps.clock.nowIso() });
    return status;
  }

  private async saveOutcome(proposal: AiWriteProposal, attempts = 3): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.deps.proposals.save(proposal);
      } catch (error) {
        if (attempt >= attempts) throw error;
      }
    }
  }
}
