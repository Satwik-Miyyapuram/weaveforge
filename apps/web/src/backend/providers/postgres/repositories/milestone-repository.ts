import type { IMilestoneRepository, Milestone, MilestoneFilter } from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import {
  milestoneToDomain as toDomain,
  milestoneToRow as toRow,
  type MilestoneRow,
} from "@/features/plan/infrastructure/milestone-rows";
import type { PgRunner } from "../pg-runner";

export class PostgresMilestoneRepository implements IMilestoneRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
  ) {}

  private get pid() {
    return this.ctx.projectId;
  }

  async getById(id: string): Promise<Milestone | null> {
    const row = await this.pg.queryOne<MilestoneRow>("select * from milestones where id = $1", [id]);
    return row ? toDomain(row) : null;
  }

  async list(filter?: MilestoneFilter): Promise<Milestone[]> {
    if (!this.pid) return [];
    const clauses = ["1=1"];
    const params: unknown[] = [];
    params.push(this.pid);
    clauses.push(`project_id = $${params.length}`);
    if (filter?.status) {
      params.push(filter.status);
      clauses.push(`status = $${params.length}`);
    }
    if (filter?.titleContains) {
      params.push(`%${filter.titleContains}%`);
      clauses.push(`title ilike $${params.length}`);
    }
    const rows = await this.pg.query<MilestoneRow>(
      `select * from milestones where ${clauses.join(" and ")}
       order by target_date asc nulls last`,
      params,
    );
    return rows.map(toDomain);
  }

  async save(entity: Milestone): Promise<void> {
    const row = toRow(entity);
    if (this.pid) row.project_id = this.pid;
    const cols = Object.keys(row);
    const vals = cols.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    await this.pg.exec(
      `insert into milestones (${cols.join(",")}) values (${vals.join(",")})
       on conflict (id) do update set ${updates.join(",")}`,
      cols.map((c) => row[c]),
    );
  }

  async delete(id: string): Promise<void> {
    await this.pg.exec("delete from milestones where id = $1", [id]);
  }
}
