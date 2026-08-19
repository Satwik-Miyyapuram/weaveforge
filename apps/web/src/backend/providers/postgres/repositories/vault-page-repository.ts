import {
  buildPageTree,
  type IVaultPageRepository,
  type VaultPage,
  type VaultPageFilter,
  type VaultPageTreeNode,
  type EntityStamp,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import type { PgRunner } from "@/backend/providers/postgres/pg-runner";
import {
  type VaultPageRow,
  toDomain,
  toSummaryDomain,
  toRow,
} from "@/features/vault/infrastructure/vault-page-rows";

/** Prefer generated column when migrated; otherwise compute left(body) inline. */
const VAULT_SUMMARY_COLUMNS =
  "id, title, parent_id, sort_order, created_at, updated_at, project_id, left(coalesce(body, ''), 320) as body_preview";

export class PostgresVaultPageRepository implements IVaultPageRepository {
  constructor(
    private readonly pg: PgRunner,
    private readonly ctx: ProjectContext,
  ) {}

  private get pid() {
    return this.ctx.projectId;
  }

  async getById(id: string): Promise<VaultPage | null> {
    const row = await this.pg.queryOne<VaultPageRow>(
      "select * from vault_pages where id = $1",
      [id],
    );
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
      `select id, updated_at, created_at from vault_pages where ${where} order by sort_order asc`,
      params,
    );
    return rows.map((row) => ({ id: row.id, updatedAt: row.updated_at ?? row.created_at }));
  }

  async listByIds(ids: readonly string[]): Promise<VaultPage[]> {
    if (ids.length === 0) return [];
    const rows = await this.pg.query<VaultPageRow>(
      `select * from vault_pages where id = any($1)`,
      [ids as string[]],
    );
    return rows.map(toDomain);
  }

  async list(filter?: VaultPageFilter): Promise<VaultPage[]> {
    const clauses = ["1=1"];
    const params: unknown[] = [];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    if (filter?.parentId !== undefined) {
      if (filter.parentId === null) {
        clauses.push("parent_id is null");
      } else {
        params.push(filter.parentId);
        clauses.push(`parent_id = $${params.length}`);
      }
    }
    if (filter?.query) {
      params.push(`%${filter.query}%`);
      clauses.push(`(title ilike $${params.length} or body ilike $${params.length})`);
    }
    const rows = await this.pg.query<VaultPageRow>(
      `select * from vault_pages where ${clauses.join(" and ")}
       order by sort_order asc, title asc`,
      params,
    );
    return rows.map(toDomain);
  }

  async listSummaries(): Promise<VaultPage[]> {
    const clauses = ["1=1"];
    const params: unknown[] = [];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    const rows = await this.pg.query<VaultPageRow>(
      `select ${VAULT_SUMMARY_COLUMNS} from vault_pages where ${clauses.join(" and ")}
       order by sort_order asc, title asc`,
      params,
    );
    return rows.map(toSummaryDomain);
  }

  async getTree(): Promise<VaultPageTreeNode[]> {
    const clauses = ["1=1"];
    const params: unknown[] = [];
    if (this.pid) {
      params.push(this.pid);
      clauses.push(`project_id = $${params.length}`);
    }
    const rows = await this.pg.query<VaultPageRow>(
      `select ${VAULT_SUMMARY_COLUMNS} from vault_pages where ${clauses.join(" and ")}`,
      params,
    );
    return buildPageTree(rows.map(toSummaryDomain));
  }

  async save(entity: VaultPage): Promise<void> {
    const row = toRow(entity);
    if (this.pid) row.project_id = this.pid;
    const cols = Object.keys(row);
    const vals = cols.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    await this.pg.exec(
      `insert into vault_pages (${cols.join(",")}) values (${vals.join(",")})
       on conflict (id) do update set ${updates.join(",")}`,
      cols.map((c) => row[c]),
    );
  }

  async delete(id: string): Promise<void> {
    await this.pg.exec("delete from vault_pages where id = $1", [id]);
  }
}

