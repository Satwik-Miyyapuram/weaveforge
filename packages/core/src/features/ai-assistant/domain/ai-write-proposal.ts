import type { AiProposalKind } from "./ai-types.js";

export interface AiWriteProposal {
  id: string;
  kind: AiProposalKind;
  resourceId: string;
  content: string;
  createdAt: string;
  status: "pending" | "accepted" | "rejected" | "conflicted";
  sourceLinks: readonly string[];
  /** Revision observed when the proposal was created; writes must compare it. */
  expectedRevision?: string;
  /** Typed, encrypted executor input. The server never sees this payload. */
  payload?: Record<string, unknown>;
}

export interface IAiProposalStore {
  save(proposal: AiWriteProposal): Promise<void>;
  getById(id: string): Promise<AiWriteProposal | null>;
  listPending(): Promise<AiWriteProposal[]>;
}

export interface IAiPaperNoteAppender {
  /** Must append to the existing note; implementations must never replace it. */
  appendPaperNote(input: { paperId: string; addition: string; expectedRevision?: string }): Promise<"appended" | "conflicted">;
}

export interface AiAuditRecord {
  id: string;
  proposalId: string;
  action: "accepted" | "rejected" | "conflicted";
  createdAt: string;
}

export interface IAiAuditStore {
  save(record: AiAuditRecord): Promise<void>;
}

export type AiProposalExecution = "accepted" | "conflicted";

/** One implementation per kind; no executor is reachable from an MCP tool. */
export interface IAiProposalExecutor {
  readonly kind: AiProposalKind;
  execute(proposal: AiWriteProposal): Promise<AiProposalExecution>;
}

export class AiProposalExecutorRegistry {
  private readonly executors = new Map<AiProposalKind, IAiProposalExecutor>();

  constructor(executors: readonly IAiProposalExecutor[]) {
    for (const executor of executors) this.executors.set(executor.kind, executor);
  }

  async execute(proposal: AiWriteProposal): Promise<AiProposalExecution> {
    const executor = this.executors.get(proposal.kind);
    if (!executor) throw new Error(`No proposal executor is registered for ${proposal.kind}.`);
    return executor.execute(proposal);
  }
}

export function appendPaperNote(existing: string | undefined, addition: string): string {
  const next = addition.trim();
  if (!next) throw new Error("Note addition is required");
  const current = existing?.trim();
  return current ? `${current}\n\n${next}` : next;
}
