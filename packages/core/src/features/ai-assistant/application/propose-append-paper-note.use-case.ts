import type { AiAccessPolicy } from "../domain/ai-access-policy.js";
import type { AiAccessSettings, AiSessionGrant } from "../domain/ai-types.js";
import type { AiWriteProposal, IAiProposalStore } from "../domain/ai-write-proposal.js";

export interface ProposeAppendPaperNoteInput {
  id: string;
  paperId: string;
  addition: string;
  settings: AiAccessSettings;
  grant: AiSessionGrant;
  encryptionUnlocked: boolean;
  now?: string;
  sourceLinks?: readonly string[];
  expectedRevision?: string;
}

export class ProposeAppendPaperNoteUseCase {
  constructor(
    private readonly deps: {
      policy: Pick<AiAccessPolicy, "evaluate">;
      proposals: IAiProposalStore;
      clock: { nowIso(): string };
    },
  ) {}

  async execute(input: ProposeAppendPaperNoteInput): Promise<AiWriteProposal> {
    const addition = input.addition.trim();
    if (!input.paperId.trim() || !addition) throw new Error("Paper and note addition are required");
    const decision = this.deps.policy.evaluate({
      settings: input.settings,
      grant: input.grant,
      encryptionUnlocked: input.encryptionUnlocked,
      now: input.now,
      tool: "propose_append_paper_note",
      resourceType: "paper_note",
      resourceId: input.paperId,
      proposalKind: "append_paper_note",
    });
    if (!decision.allowed) throw new Error(`AI proposal denied: ${decision.reason}`);
    const proposal: AiWriteProposal = {
      id: input.id,
      kind: "append_paper_note",
      resourceId: input.paperId,
      content: addition,
      createdAt: this.deps.clock.nowIso(),
      status: "pending",
      sourceLinks: input.sourceLinks ?? [],
      expectedRevision: input.expectedRevision,
    };
    await this.deps.proposals.save(proposal);
    return proposal;
  }
}
