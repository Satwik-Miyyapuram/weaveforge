import {
  buildSectionTree,
  type IReportSectionRepository,
  type ReportSection,
  type ReportSectionFilter,
  type ReportSectionTreeNode,
  type ReportStatus,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import type { PgRunner } from "../pg-runner";
import {
  reportSectionToDomain as toDomain,
  reportSectionToRow as toRow,
  type ReportSectionRow,
} from "@/features/report/infrastructure/report-section-rows";

export class PostgresReportSectionRepository implements IReportSectionRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
  ) {}

  private get pid() {
    return this.ctx.projectId;
  }

  async getById(id: string): Promise<ReportSection | null> {
    const row = await this.pg.queryOne<ReportSectionRow>(
      "select * from report_sections where id = $1",
      [id],
    );
    return row ? toDomain(row) : null;
  }

  async list(filter?: ReportSectionFilter): Promise<ReportSection[]> {
    const clauses = ["1=1"];
    const params: unknown[] = [];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    if (filter?.status) {
      params.push(filter.status);
      clauses.push(`status = $${params.length}`);
    }
    if (filter?.parentId !== undefined) {
      if (filter.parentId === null) {
        clauses.push("parent_id is null");
      } else {
        params.push(filter.parentId);
        clauses.push(`parent_id = $${params.length}`);
      }
    }
    if (filter?.titleContains) {
      params.push(`%${filter.titleContains}%`);
      clauses.push(`title ilike $${params.length}`);
    }
    const rows = await this.pg.query<ReportSectionRow>(
      `select * from report_sections where ${clauses.join(" and ")}
       order by sort_order asc, section_no asc`,
      params,
    );
    return rows.map(toDomain);
  }

  async getTree(): Promise<ReportSectionTreeNode[]> {
    const clauses = ["1=1"];
    const params: unknown[] = [];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    const rows = await this.pg.query<ReportSectionRow>(
      `select * from report_sections where ${clauses.join(" and ")}`,
      params,
    );
    return buildSectionTree(rows.map(toDomain));
  }

  async save(entity: ReportSection): Promise<void> {
    const row = toRow(entity);
    if (this.pid) row.project_id = this.pid;
    const cols = Object.keys(row);
    const vals = cols.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    await this.pg.exec(
      `insert into report_sections (${cols.join(",")}) values (${vals.join(",")})
       on conflict (id) do update set ${updates.join(",")}`,
      cols.map((c) => row[c]),
    );
  }

  async delete(id: string): Promise<void> {
    await this.pg.exec("delete from report_sections where id = $1", [id]);
  }
}

