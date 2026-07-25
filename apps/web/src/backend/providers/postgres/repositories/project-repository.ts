import type { ICurrentUserProvider, IProjectRepository, Project } from "@thesis/core";
import type { PgRunner } from "../pg-runner";

interface ProjectRow {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export class PostgresProjectRepository implements IProjectRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly session: ICurrentUserProvider,
  ) {}

  async getById(id: string): Promise<Project | null> {
    const row = await this.pg.queryOne<ProjectRow>("select * from projects where id = $1", [id]);
    return row ? toDomain(row) : null;
  }

  async list(): Promise<Project[]> {
    const rows = await this.pg.query<ProjectRow>("select * from projects order by created_at");
    return rows.map(toDomain);
  }

  async save(entity: Project): Promise<void> {
    const userId = await this.session.getCurrentUserId();
    await this.pg.exec(
      `insert into projects (id, user_id, name, color, created_at)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update set name = excluded.name, color = excluded.color`,
      [entity.id, userId, entity.name, entity.color ?? null, entity.createdAt],
    );
  }

  async delete(id: string): Promise<void> {
    await this.pg.exec("delete from projects where id = $1", [id]);
  }
}

function toDomain(r: ProjectRow): Project {
  return { id: r.id, name: r.name, color: r.color ?? undefined, createdAt: r.created_at };
}
