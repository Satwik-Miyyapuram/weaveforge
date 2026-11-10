import type { AiAccessPolicy, AiAccessSettings, AiEvidence, AiProposalKind, AiResourceType, AiSessionGrant, AiToolName } from "../domain/ai-types.js";
import type { AiWriteProposal, IAiProposalStore } from "../domain/ai-write-proposal.js";
import { rust } from "../../../shared/rust.js";

/** The only application command allowed to persist an AI-originated draft. */
export class CreateAiProposalDraftUseCase {
  constructor(private readonly deps: {
    policy: Pick<AiAccessPolicy, "evaluate">; proposals: Pick<IAiProposalStore, "save">; clock: { nowIso(): string };
  }) {}

  async execute(input: {
    id: string; kind: AiProposalKind; tool: AiToolName; resourceId: string; content: string;
    payload: Record<string, unknown>; settings: AiAccessSettings; grant: AiSessionGrant;
    encryptionUnlocked: boolean; resourceType?: AiResourceType; expectedRevision?: string;
    sourceLinks?: readonly string[]; evidence?: readonly AiEvidence[]; now?: string;
  }): Promise<AiWriteProposal> {
    const decision = this.deps.policy.evaluate({
      settings: input.settings, grant: input.grant, encryptionUnlocked: input.encryptionUnlocked,
      now: input.now, tool: input.tool, proposalKind: input.kind,
      resourceType: input.resourceType, resourceId: input.resourceId,
    });
    if (!decision.allowed) throw new Error(`AI proposal denied: ${decision.reason}`);
    // Trimming, the blank-preview check and evidence shaping are Rust (wf-core `ai::proposal_draft`).
    const proposal = rust().shapeAiProposalDraft({
      id: input.id, kind: input.kind, resourceId: input.resourceId, content: input.content,
      payload: input.payload, createdAt: this.deps.clock.nowIso(),
      sourceLinks: input.sourceLinks ? [...input.sourceLinks] : undefined,
      expectedRevision: input.expectedRevision, evidence: input.evidence ? [...input.evidence] : undefined,
    }) as AiWriteProposal;
    await this.deps.proposals.save(proposal);
    return proposal;
  }
}
