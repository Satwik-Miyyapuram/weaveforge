import {
  AiProposalExecutorRegistry,
  ExecuteAiProposalUseCase,
  type AiProposalKind,
  type AiWriteProposal,
  type IAiAuditStore,
  type IAiProposalStore,
} from "@weaveforge/core";
import { singleFlight } from "@/lib/cache/single-flight";

/** How long the pending-proposal count is reused across the shell's badges. */
const PENDING_PROPOSALS_MEMO_MS = 15_000;

/** Browser-only review boundary. MCP tools may draft proposals but cannot reach this facade. */
export class AiProposalFacade {
  private readonly executeProposal: ExecuteAiProposalUseCase;

  constructor(private readonly deps: {
    proposals: IAiProposalStore; audit: IAiAuditStore; executors: AiProposalExecutorRegistry;
    newId: () => string; now: () => string;
  }) {
    this.executeProposal = new ExecuteAiProposalUseCase({
      proposals: deps.proposals, audit: deps.audit, executors: deps.executors,
      ids: { newId: deps.newId }, clock: { nowIso: deps.now },
    });
  }

  /**
   * Pending proposals, shared across the burst of callers a page load makes.
   *
   * The review badge is rendered by every `HeaderActions` the shell mounts —
   * nav, mobile header, menu — and they mount as the breakpoint resolves rather
   * than together, so single-flight alone still left several identical queries.
   * The short window covers the whole boot; anything that changes the queue
   * dispatches `ai-proposals-changed`, and that path clears it.
   */
  listPending(): Promise<AiWriteProposal[]> {
    const now = Date.now();
    if (this.pendingMemo && now - this.pendingMemo.at < PENDING_PROPOSALS_MEMO_MS) {
      return this.pendingMemo.value;
    }
    const value = singleFlight("ai-proposals:pending", () => this.deps.proposals.listPending());
    this.pendingMemo = { at: now, value };
    void value.catch(() => {
      if (this.pendingMemo?.value === value) this.pendingMemo = null;
    });
    return value;
  }

  private pendingMemo: { at: number; value: Promise<AiWriteProposal[]> } | null = null;

  /** Drop the memo — call after anything that changes the queue. */
  forgetPending(): void {
    this.pendingMemo = null;
  }

  /**
   * Queue a draft the user asked for themselves, from inside the app.
   *
   * Deliberately not routed through `CreateAiProposalDraftUseCase`: that path
   * exists to gate an *external* agent acting over MCP, and evaluates a session
   * grant to decide whether that agent may touch a resource. Here the actor is
   * the signed-in user clicking a button in their own workspace, so there is no
   * third party to authorise — applying the grant check would mean refusing to
   * queue work the user explicitly requested.
   *
   * The write gate is unchanged: this only produces a pending row, and nothing
   * reaches a repository until it is approved in the review queue.
   */
  async draftLocal(input: {
    kind: AiProposalKind;
    resourceId: string;
    content: string;
    payload?: Record<string, unknown>;
    sourceLinks?: readonly string[];
    expectedRevision?: string;
  }): Promise<AiWriteProposal> {
    const content = input.content.trim();
    if (!content) throw new Error("A proposal needs a preview describing what it will do.");

    const proposal: AiWriteProposal = {
      id: this.deps.newId(),
      kind: input.kind,
      resourceId: input.resourceId,
      content,
      payload: input.payload,
      createdAt: this.deps.now(),
      status: "pending",
      sourceLinks: input.sourceLinks ?? [],
      expectedRevision: input.expectedRevision,
    };
    await this.deps.proposals.save(proposal);
    this.forgetPending();
    return proposal;
  }
  async pendingCount(): Promise<number> { return (await this.listPending()).length; }
  async approve(id: string): Promise<"accepted" | "conflicted"> {
    const result = await this.executeProposal.execute(id);
    this.forgetPending();
    return result;
  }

  async reject(id: string): Promise<void> {
    const proposal = await this.deps.proposals.getById(id);
    if (!proposal) throw new Error("AI proposal not found");
    if (proposal.status !== "pending") throw new Error("AI proposal is no longer pending");
    await this.deps.proposals.save({ ...proposal, status: "rejected" });
    this.forgetPending();
    await this.deps.audit.save({ id: this.deps.newId(), proposalId: id, action: "rejected", createdAt: this.deps.now() });
  }

  /** Returns how many were not applied because their target changed. */
  async approveSafeBatch(ids: readonly string[]): Promise<number> {
    let conflicted = 0;
    for (const id of ids) if ((await this.approve(id)) === "conflicted") conflicted += 1;
    return conflicted;
  }
}
