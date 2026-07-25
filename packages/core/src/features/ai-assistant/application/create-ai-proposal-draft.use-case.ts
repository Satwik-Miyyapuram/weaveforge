import type { AiAccessPolicy } from "../domain/ai-access-policy.js";
import type { AiAccessSettings, AiProposalKind, AiResourceType, AiSessionGrant, AiToolName } from "../domain/ai-types.js";
import type { AiWriteProposal, IAiProposalStore } from "../domain/ai-write-proposal.js";

/** The only application command allowed to persist an AI-originated draft. */
export class CreateAiProposalDraftUseCase {
  constructor(private readonly deps: {
    policy: Pick<AiAccessPolicy, "evaluate">; proposals: IAiProposalStore; clock: { nowIso(): string };
  }) {}

  async execute(input: {
    id: string; kind: AiProposalKind; tool: AiToolName; resourceId: string; content: string;
    payload: Record<string, unknown>; settings: AiAccessSettings; grant: AiSessionGrant;
    encryptionUnlocked: boolean; resourceType?: AiResourceType; expectedRevision?: string;
    sourceLinks?: readonly string[]; now?: string;
  }): Promise<AiWriteProposal> {
    const decision = this.deps.policy.evaluate({
      settings: input.settings, grant: input.grant, encryptionUnlocked: input.encryptionUnlocked,
      now: input.now, tool: input.tool, proposalKind: input.kind,
      resourceType: input.resourceType, resourceId: input.resourceId,
    });
    if (!decision.allowed) throw new Error(`AI proposal denied: ${decision.reason}`);
    const proposal: AiWriteProposal = {
      id: input.id, kind: input.kind, resourceId: input.resourceId, content: input.content.trim(),
      payload: input.payload, createdAt: this.deps.clock.nowIso(), status: "pending",
      sourceLinks: input.sourceLinks ?? [], expectedRevision: input.expectedRevision,
    };
    if (!proposal.content) throw new Error("AI proposal preview is required.");
    await this.deps.proposals.save(proposal);
    return proposal;
  }
}
