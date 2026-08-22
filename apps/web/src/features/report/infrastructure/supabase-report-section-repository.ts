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
import { reportSectionToDomain, reportSectionToRow, type ReportSectionRow } from "./report-section-rows";
import { deleteRowById, rowById } from "@/backend/providers/supabase/row-access";

/**
 * Supabase implementation of IReportSectionRepository.
 *
 * Persistence only against the `report_sections` table (snake_case <->
 * camelCase mapping). The tree is assembled by the shared pure helper so it is
 * identical to the in-memory implementation. Must pass the same contract suite.
 */


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
    const row = await rowById<ReportSectionRow>(this.db, TABLE, id);
    return row ? reportSectionToDomain(row) : null;
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
    return (data as ReportSectionRow[]).map(reportSectionToDomain);
  }

  async getTree(): Promise<ReportSectionTreeNode[]> {
    let q = this.db.from(TABLE).select("*");
    if (this.pid) q = q.eq("project_id", this.pid);
    const { data, error } = await q;
    if (error) throw error;
    return buildSectionTree((data as ReportSectionRow[]).map(reportSectionToDomain));
  }

  async save(entity: ReportSection): Promise<void> {
    const row = reportSectionToRow(entity);
    if (this.pid) row.project_id = this.pid;
    const { error } = await this.db.from(TABLE).upsert(row);
    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    await deleteRowById(this.db, TABLE, id);
  }
}

