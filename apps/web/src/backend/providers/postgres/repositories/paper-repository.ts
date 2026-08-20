import {
  normalizeDoi,
  type IPaperRepository,
  type Paper,
  type PaperFilter,
  type PaperStatus,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import type { EntityStamp } from "@weaveforge/core";
import type { PgRunner } from "../pg-runner";
import {
  type PaperRow,
  emptyToNull,
  toRow,
  toDomain,
} from "@/features/papers/infrastructure/paper-rows";

// List cards need small filter/display fields only (plaintext under RLS).
// Detail and Zotero sync keep richer rows via select * / fat list where needed.
const PAPER_LIST_COLUMNS = [
  "id",
  "title",
  "authors",
  "status",
  "year",
  "read_at",
  "pdf_path",
  "tags",
  "created_at",
  "updated_at",
  "project_id",
  "summary",
  "doi",
  "arxiv_id",
  "url",
].join(", ");

/** Richer projection for filtered list / sync paths that still need abstracts. */
const PAPER_FULL_LIST_COLUMNS = [
  PAPER_LIST_COLUMNS,
  "venue",
  "abstract",
  "bibtex",
  "metadata",
  "rating",
  "doi_bidx",
  "arxiv_bidx",
].join(", ");

export class PostgresPaperRepository implements IPaperRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
  ) {}

  private get pid() {
    return this.ctx.projectId;
  }

  async getById(id: string): Promise<Paper | null> {
    const row = await this.pg.queryOne<PaperRow>("select * from papers where id = $1", [id]);
    return row ? toDomain(row) : null;
  }

  /**
   * Ids and versions only — the cheap first half of a delta read. Two columns
   * over the table is a fraction of what the rows weigh, and it is what lets
   * the caller ask for only the handful that changed.
   */
  async listStamps(): Promise<EntityStamp[]> {
    const params: unknown[] = [];
    let where = "1=1";
    if (this.pid) {
      params.push(this.pid);
      where = `project_id = $${params.length}`;
    }
    const rows = await this.pg.query<{ id: string; updated_at: string | null; created_at: string }>(
      `select id, updated_at, created_at from papers where ${where} order by created_at desc`,
      params,
    );
    return rows.map((row) => ({ id: row.id, updatedAt: row.updated_at ?? row.created_at }));
  }

  async listByIds(ids: readonly string[]): Promise<Paper[]> {
    if (ids.length === 0) return [];
    const rows = await this.pg.query<PaperRow>(
      `select * from papers where id = any($1)`,
      [ids as string[]],
    );
    return rows.map(toDomain);
  }

  async list(filter?: PaperFilter): Promise<Paper[]> {
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
    if (filter?.arxivId) {
      params.push(filter.arxivId);
      clauses.push(`arxiv_id = $${params.length}`);
    }
    if (filter?.doi) {
      params.push(normalizeDoi(filter.doi)!);
      clauses.push(`doi = $${params.length}`);
    }
    if (filter?.titleContains) {
      params.push(`%${filter.titleContains}%`);
      clauses.push(`title ilike $${params.length}`);
    }
    const rows = await this.pg.query<PaperRow>(
      `select ${PAPER_FULL_LIST_COLUMNS} from papers where ${clauses.join(" and ")} order by created_at desc`,
      params,
    );
    return rows.map(toDomain);
  }

  async listSummaries(): Promise<Paper[]> {
    const clauses = ["1=1"];
    const params: unknown[] = [];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    const rows = await this.pg.query<PaperRow>(
      `select ${PAPER_LIST_COLUMNS} from papers where ${clauses.join(" and ")} order by created_at desc`,
      params,
    );
    return rows.map(toDomain);
  }

  async save(entity: Paper): Promise<void> {
    const row = toRow(entity);
    if (this.pid) row.project_id = this.pid;
    const cols = Object.keys(row);
    const vals = cols.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    await this.pg.exec(
      `insert into papers (${cols.join(",")}) values (${vals.join(",")})
       on conflict (id) do update set ${updates.join(",")}`,
      cols.map((c) => row[c]),
    );
  }

  async delete(id: string): Promise<void> {
    await this.pg.exec("delete from papers where id = $1", [id]);
  }

  async findByArxivId(arxivId: string): Promise<Paper | null> {
    const clauses = ["arxiv_id = $1"];
    const params: unknown[] = [arxivId];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    const row = await this.pg.queryOne<PaperRow>(
      `select * from papers where ${clauses.join(" and ")}`,
      params,
    );
    return row ? toDomain(row) : null;
  }

  async findByDoi(doi: string): Promise<Paper | null> {
    const clauses = ["doi = $1"];
    const params: unknown[] = [normalizeDoi(doi)!];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    const row = await this.pg.queryOne<PaperRow>(
      `select * from papers where ${clauses.join(" and ")}`,
      params,
    );
    return row ? toDomain(row) : null;
  }
}


