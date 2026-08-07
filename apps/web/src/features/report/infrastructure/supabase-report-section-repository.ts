import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildSectionTree,
  type IReportSectionRepository,
  type ReportSection,
  type ReportSectionFilter,
  type ReportSectionTreeNode,
  type ReportStatus,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import {
  attachEncryptedRow,
  encryptedRowFields,
} from "@/lib/encrypted-row";

/**
 * Supabase implementation of IReportSectionRepository.
 *
 * Persistence only against the `report_sections` table (snake_case <->
 * camelCase mapping). The tree is assembled by the shared pure helper so it is
 * identical to the in-memory implementation. Must pass the same contract suite.
 */

interface ReportSectionRow {
  id: string;
  title: string;
  section_no: string | null;
  parent_id: string | null;
  status: ReportStatus;
  word_count: number;
  target_words: number | null;
  deadline: string | null;
  draft_url: string | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  content_enc: string | null;
  enc_epoch: number | null;
}

const TABLE = "report_sections";

export class SupabaseReportSectionRepository
  implements IReportSectionRepository
{
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
  ) {}
  private get pid() { return this.ctx.projectId; }

  async getById(id: string): Promise<ReportSection | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as ReportSectionRow) : null;
  }

  async list(filter?: ReportSectionFilter): Promise<ReportSection[]> {
    let query = this.db.from(TABLE).select("*");
    if (this.pid) query = query.eq("project_id", this.pid);
    if (filter?.status) query = query.eq("status", filter.status);
    if (filter?.parentId !== undefined) {
      query =
        filter.parentId === null
          ? query.is("parent_id", null)
          : query.eq("parent_id", filter.parentId);
    }
    if (filter?.titleContains) {
      // Server ilike removed under E2EE — encryptRepo filters client-side post-decrypt.
    }
    query = query
      .order("sort_order", { ascending: true })
      .order("section_no", { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    return (data as ReportSectionRow[]).map(toDomain);
  }

  async getTree(): Promise<ReportSectionTreeNode[]> {
    let q = this.db.from(TABLE).select("*");
    if (this.pid) q = q.eq("project_id", this.pid);
    const { data, error } = await q;
    if (error) throw error;
    return buildSectionTree((data as ReportSectionRow[]).map(toDomain));
  }

  async save(entity: ReportSection): Promise<void> {
    const row = toRow(entity);
    if (this.pid) row.project_id = this.pid;
    const { error } = await this.db.from(TABLE).upsert(row);
    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.db.from(TABLE).delete().eq("id", id);
    if (error) throw error;
  }
}

function toDomain(row: ReportSectionRow): ReportSection {
  return attachEncryptedRow(
    {
      id: row.id,
      title: row.title,
      sectionNo: row.section_no ?? undefined,
      parentId: row.parent_id ?? undefined,
      status: row.status,
      wordCount: row.word_count,
      targetWords: row.target_words ?? undefined,
      deadline: row.deadline ?? undefined,
      draftUrl: row.draft_url ?? undefined,
      notes: row.notes ?? undefined,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
    },
    row,
  );
}

function toRow(s: ReportSection): Record<string, unknown> {
  return {
    id: s.id,
    title: s.title ?? "",
    section_no: s.sectionNo ?? null,
    parent_id: s.parentId ?? null,
    status: s.status,
    word_count: s.wordCount,
    target_words: s.targetWords ?? null,
    deadline: s.deadline ?? null,
    draft_url: s.draftUrl ?? null,
    notes: s.notes ?? null,
    sort_order: s.sortOrder,
    created_at: s.createdAt,
    ...encryptedRowFields(s),
  };
}
