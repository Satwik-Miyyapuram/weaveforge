import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AiAuditRecord,
  AiWriteProposal,
  IAiAuditStore,
  IAiProposalStore,
  ICurrentUserProvider,
} from "@weaveforge/core";
import { run } from "@/backend/providers/supabase/row-access";

type ProposalRow = {
  id: string;
  kind: AiWriteProposal["kind"];
  status: AiWriteProposal["status"];
  resource_type: string;
  resource_id: string;
  expected_revision: string | null;
  content: AiWriteProposal;
  created_at: string;
};

/**
 * The columns a proposal is read as, named rather than starred.
 *
 * `content` is the whole proposal as jsonb and `ai_proposals` is queried per
 * review screen; a star would carry any column added later into a queue nobody
 * asked it to join.
 */
const PROPOSAL_COLUMNS =
  "id,kind,status,resource_type,resource_id,expected_revision,content,created_at";

/**
 * User-owned proposal persistence. Proposal text, source links, and audit
 * details are stored as plaintext JSON (RLS + at-rest); lifecycle indexes stay
 * as columns for querying.
 */
export class SupabaseAiProposalStore implements IAiProposalStore {
  constructor(
    private readonly db: SupabaseClient,
    private readonly session: ICurrentUserProvider,
    private readonly projectId: () => string | null,
  ) {}

  async save(proposal: AiWriteProposal): Promise<void> {
    const userId = await this.session.requireUserId();
    await run(this.db.from("ai_proposals").upsert({
      id: proposal.id,
      user_id: userId,
      project_id: this.projectId(),
      kind: proposal.kind,
      status: proposal.status,
      resource_type: proposal.kind,
      resource_id: proposal.resourceId,
      expected_revision: proposal.expectedRevision ?? null,
      content: proposal,
      created_at: proposal.createdAt,
      updated_at: new Date().toISOString(),
    }));
  }

  async getById(id: string): Promise<AiWriteProposal | null> {
    const { data, error } = await this.db.from("ai_proposals").select(PROPOSAL_COLUMNS).eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? this.fromRow(data as ProposalRow) : null;
  }

  async listPending(): Promise<AiWriteProposal[]> {
    const { data, error } = await this.db
      .from("ai_proposals")
      .select(PROPOSAL_COLUMNS)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as ProposalRow[]).map((row) => this.fromRow(row));
  }

  private fromRow(row: ProposalRow): AiWriteProposal {
    const proposal = row.content;
    // Indexed lifecycle fields are the authoritative server-visible state.
    return {
      ...proposal,
      id: row.id,
      kind: row.kind,
      status: row.status,
      resourceId: row.resource_id,
      expectedRevision: row.expected_revision ?? undefined,
      createdAt: row.created_at,
    };
  }
}

export class SupabaseAiAuditStore implements IAiAuditStore {
  constructor(
    private readonly db: SupabaseClient,
    private readonly session: ICurrentUserProvider,
    private readonly projectId: () => string | null,
  ) {}

  async save(record: AiAuditRecord): Promise<void> {
    const userId = await this.session.requireUserId();
    await run(this.db.from("ai_audit_records").insert({
      id: record.id,
      user_id: userId,
      project_id: this.projectId(),
      proposal_id: record.proposalId,
      action: record.action,
      content: record,
      created_at: record.createdAt,
    }));
  }
}
