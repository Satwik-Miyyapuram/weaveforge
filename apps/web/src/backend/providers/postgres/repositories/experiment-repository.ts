import type {
  Experiment,
  ExperimentFilter,
  ExperimentStatus,
  IExperimentRepository,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import type { PgRunner } from "../pg-runner";

interface ExperimentRow {
  id: string;
  name: string;
  hypothesis: string | null;
  status: ExperimentStatus;
  repo_url: string | null;
  commit_sha: string | null;
  branch: string | null;
  run_command: string | null;
  config: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  artifacts: string[] | null;
  result_note: string | null;
  started_at: string | null;
  finished_at: string | null;
  related_paper: string | null;
  created_at: string;
}

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

function toDomain(r: ExperimentRow): Experiment {
  return {
    id: r.id,
    name: r.name,
    hypothesis: r.hypothesis ?? undefined,
    status: r.status,
    repoUrl: r.repo_url ?? undefined,
    commitSha: r.commit_sha ?? undefined,
    branch: r.branch ?? undefined,
    runCommand: r.run_command ?? undefined,
    config: r.config ?? {},
    metrics: r.metrics ?? {},
    artifacts: r.artifacts ?? [],
    resultNote: r.result_note ?? undefined,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    relatedPaper: r.related_paper ?? undefined,
    createdAt: r.created_at,
  };
}

function toRow(e: Experiment): Record<string, unknown> {
  return {
    id: e.id,
    name: e.name,
    hypothesis: e.hypothesis ?? null,
    status: e.status,
    repo_url: e.repoUrl ?? null,
    commit_sha: e.commitSha ?? null,
    branch: e.branch ?? null,
    run_command: e.runCommand ?? null,
    config: e.config,
    metrics: e.metrics,
    artifacts: e.artifacts,
    result_note: e.resultNote ?? null,
    started_at: e.startedAt ?? null,
    finished_at: e.finishedAt ?? null,
    related_paper: e.relatedPaper ?? null,
    created_at: e.createdAt,
  };
}
