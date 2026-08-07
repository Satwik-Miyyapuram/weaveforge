import type {
  IPaperRelationRepository,
  PaperRelation,
  PaperRelationFilter,
  RelationType,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import type { PgRunner } from "../pg-runner";

interface PaperRelationRow {
  id: string;
  from_paper: string;
  to_paper: string;
  relation: RelationType;
  note: string | null;
  source: "manual" | "auto";
  created_at: string;
}

export class PostgresPaperRelationRepository implements IPaperRelationRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
  ) {}

  private get pid() {
    return this.ctx.projectId;
  }

  async getById(id: string): Promise<PaperRelation | null> {
    const row = await this.pg.queryOne<PaperRelationRow>(
      "select * from paper_relations where id = $1",
      [id],
    );
    return row ? toDomain(row) : null;
  }

  async list(filter?: PaperRelationFilter): Promise<PaperRelation[]> {
    const clauses = ["1=1"];
    const params: unknown[] = [];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    if (filter?.relation) {
      params.push(filter.relation);
      clauses.push(`relation = $${params.length}`);
    }
    if (filter?.fromPaper) {
      params.push(filter.fromPaper);
      clauses.push(`from_paper = $${params.length}`);
    }
    if (filter?.toPaper) {
      params.push(filter.toPaper);
      clauses.push(`to_paper = $${params.length}`);
    }
    const rows = await this.pg.query<PaperRelationRow>(
      `select * from paper_relations where ${clauses.join(" and ")} order by created_at asc`,
      params,
    );
    return rows.map(toDomain);
  }

  async getGraph(): Promise<PaperRelation[]> {
    const clauses = ["1=1"];
    const params: unknown[] = [];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    const rows = await this.pg.query<PaperRelationRow>(
      `select * from paper_relations where ${clauses.join(" and ")}`,
      params,
    );
    return rows.map(toDomain);
  }

  async relationsFor(paperId: string): Promise<PaperRelation[]> {
    const clauses = ["(from_paper = $1 or to_paper = $1)"];
    const params: unknown[] = [paperId];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    const rows = await this.pg.query<PaperRelationRow>(
      `select * from paper_relations where ${clauses.join(" and ")}`,
      params,
    );
    return rows.map(toDomain);
  }

  async findEdge(
    fromPaper: string,
    toPaper: string,
    relation: RelationType,
  ): Promise<PaperRelation | null> {
    const row = await this.pg.queryOne<PaperRelationRow>(
      `select * from paper_relations
       where from_paper = $1 and to_paper = $2 and relation = $3`,
      [fromPaper, toPaper, relation],
    );
    return row ? toDomain(row) : null;
  }

  async save(entity: PaperRelation): Promise<void> {
    const row = toRow(entity);
    if (this.pid) row.project_id = this.pid;
    const cols = Object.keys(row);
    const vals = cols.map((_, i) => `$${i + 1}`);
    const updates = cols
      .filter((c) => c !== "id" && c !== "from_paper" && c !== "to_paper" && c !== "relation")
      .map((c) => `${c} = excluded.${c}`);
    await this.pg.exec(
      `insert into paper_relations (${cols.join(",")}) values (${vals.join(",")})
       on conflict (from_paper, to_paper, relation) do update set ${updates.join(",")}`,
      cols.map((c) => row[c]),
    );
  }

  async delete(id: string): Promise<void> {
    await this.pg.exec("delete from paper_relations where id = $1", [id]);
  }
}

function toDomain(row: PaperRelationRow): PaperRelation {
  return {
    id: row.id,
    fromPaper: row.from_paper,
    toPaper: row.to_paper,
    relation: row.relation,
    note: row.note ?? undefined,
    source: row.source,
    createdAt: row.created_at,
  };
}

function toRow(r: PaperRelation): Record<string, unknown> {
  return {
    id: r.id,
    from_paper: r.fromPaper,
    to_paper: r.toPaper,
    relation: r.relation,
    note: r.note ?? null,
    source: r.source,
    created_at: r.createdAt,
  };
}
