import { ProjectRepository } from "@/backend/providers/postgrest/project-scoped-repository";
import { deleteRowById, rowById, rows, run } from "@/backend/providers/postgrest/row-access";
import { typedCore } from "@/lib/rust-core";
import type {
  IReportSectionRepository,
  ReportSection,
  ReportSectionFilter,
  ReportSectionTreeNode,
  ReportStatus,
} from "@weaveforge/core";

// --- report-section-rows ---
/**
 * How report section rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers, which talk to the same table through
 * different clients.
 */

export interface ReportSectionRow {
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
  updated_at?: string | null;
}

export function reportSectionToDomain(row: ReportSectionRow): ReportSection {
  return {
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
    updatedAt: row.updated_at ?? undefined,
  };
}

export function reportSectionToRow(s: ReportSection): Record<string, unknown> {
  return {
    id: s.id,
    title: s.title,
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
  };
}

// --- postgrest-report-section-repository ---
/**
 * PostgREST implementation of IReportSectionRepository.
 *
 * Persistence only against the `report_sections` table (snake_case <->
 * camelCase mapping). The tree is assembled by the shared pure helper so it is
 * identical to the in-memory implementation. Must pass the same contract suite.
 */


/**
 * The columns a ReportSectionRow is read as, named rather than starred.
 *
 * Derived from the row type: exactly the fields the mapper reads, where a star
 * would mean "whatever the table grows next".
 */
const REPORT_SECTION_COLUMNS = "id,title,section_no,parent_id,status,word_count,target_words,deadline,draft_url,notes,sort_order,created_at,updated_at";

const TABLE = "report_sections";

export class PostgrestReportSectionRepository extends ProjectRepository
  implements IReportSectionRepository
{

  async getById(id: string): Promise<ReportSection | null> {
    const row = await rowById<ReportSectionRow>(this.db, TABLE, id);
    return row ? reportSectionToDomain(row) : null;
  }

  async list(filter?: ReportSectionFilter): Promise<ReportSection[]> {
    let query = this.db.from(TABLE).select(REPORT_SECTION_COLUMNS);
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
    return (await rows<ReportSectionRow>(query)).map(reportSectionToDomain);
  }

  async getTree(): Promise<ReportSectionTreeNode[]> {
    let q = this.db.from(TABLE).select(REPORT_SECTION_COLUMNS);
    if (this.pid) q = q.eq("project_id", this.pid);
    const { data, error } = await q;
    if (error) throw error;
    return typedCore().buildSectionTree((data as ReportSectionRow[]).map(reportSectionToDomain));
  }

  async save(entity: ReportSection): Promise<void> {
    const row = reportSectionToRow(entity);
    if (this.pid) row.project_id = this.pid;
    await run(this.db.from(TABLE).upsert(row));
  }

  async delete(id: string): Promise<void> {
    await deleteRowById(this.db, TABLE, id);
  }
}
