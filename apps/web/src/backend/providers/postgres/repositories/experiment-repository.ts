import type {
  Experiment,
  ExperimentFilter,
  ExperimentStatus,
  IExperimentRepository,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import type { PgRunner } from "../pg-runner";
import {
  experimentToDomain as toDomain,
  experimentToRow as toRow,
  type ExperimentRow,
} from "@/features/experiments/infrastructure/experiment-rows";

export class PostgresExperimentRepository implements IExperimentRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
  ) {}

  private get pid() {
    return this.ctx.projectId;
  }

  async getById(id: string): Promise<Experiment | null> {
    const row = await this.pg.queryOne<ExperimentRow>("select * from experiments where id = $1", [id]);
    return row ? toDomain(row) : null;
  }

  async list(filter?: ExperimentFilter): Promise<Experiment[]> {
    const clauses = ["1=1"];
    const params: unknown[] = [];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`(project_id = $${params.length} or project_id is null)`);
    }
    if (filter?.status) {
      params.push(filter.status);
      clauses.push(`status = $${params.length}`);
    }
    if (filter?.relatedPaper) {
      params.push(filter.relatedPaper);
      clauses.push(`related_paper = $${params.length}`);
    }
    if (filter?.nameContains) {
      params.push(`%${filter.nameContains}%`);
      clauses.push(`name ilike $${params.length}`);
    }
    const rows = await this.pg.query<ExperimentRow>(
      `select * from experiments where ${clauses.join(" and ")} order by created_at desc`,
      params,
    );
    return rows.map(toDomain);
  }

  async save(entity: Experiment): Promise<void> {
    const row = toRow(entity);
    if (this.pid) row.project_id = this.pid;
    const cols = Object.keys(row);
    const vals = cols.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    await this.pg.exec(
      `insert into experiments (${cols.join(",")}) values (${vals.join(",")})
       on conflict (id) do update set ${updates.join(",")}`,
      cols.map((c) => row[c]),
    );
  }

  async delete(id: string): Promise<void> {
    await this.pg.exec("delete from experiments where id = $1", [id]);
  }
}

