import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPageTree,
  vaultBodyPreview,
  type IVaultPageRepository,
  type VaultPage,
  type VaultPageFilter,
  type VaultPageTreeNode,
} from "@weaveforge/core";
import type { EntityStamp } from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import {
  type VaultPageRow,
  toDomain,
  toSummaryDomain,
  toRow,
} from "./vault-page-rows";
import { deleteRowById, rowById, rows, run } from "@/backend/providers/supabase/row-access";

/** Ids per `in (...)` request; the list travels in the URL. */
const ID_CHUNK = 200;

const TABLE = "vault_pages";

/** Tree/card projection — preview only; full body via getById on open. */
const VAULT_SUMMARY_COLUMNS =
  "id,title,parent_id,sort_order,created_at,updated_at,project_id,body_preview";

export class SupabaseVaultPageRepository implements IVaultPageRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
  ) {}

  private get pid() {
    return this.ctx.projectId;
  }

  async getById(id: string): Promise<VaultPage | null> {
    const row = await rowById<VaultPageRow>(this.db, TABLE, id);
    return row ? toDomain(row) : null;
  }

  /** Ids and versions only — the cheap first half of a delta read. */
  async listStamps(): Promise<EntityStamp[]> {
    let query = this.db.from(TABLE).select("id,updated_at,created_at");
    if (this.pid) query = query.eq("project_id", this.pid);
    query = query.order("sort_order", { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    return (data as { id: string; updated_at: string | null; created_at: string }[]).map((row) => ({
      id: row.id,
      updatedAt: row.updated_at ?? row.created_at,
    }));
  }

  async listByIds(ids: readonly string[]): Promise<VaultPage[]> {
    if (ids.length === 0) return [];
    const out: VaultPage[] = [];
    // Chunked: an `in` list travels in the URL, and a large one is rejected.
    for (let start = 0; start < ids.length; start += ID_CHUNK) {
            out.push(...(await rows<VaultPageRow>(this.db
        .from(TABLE)
        .select("*")
        .in("id", ids.slice(start, start + ID_CHUNK) as string[]))).map(toDomain));
    }
    return out;
  }

  async list(filter?: VaultPageFilter): Promise<VaultPage[]> {
    let query = this.db.from(TABLE).select("*");
    if (this.pid) query = query.eq("project_id", this.pid);
    if (filter?.parentId !== undefined) {
      query =
        filter.parentId === null
          ? query.is("parent_id", null)
          : query.eq("parent_id", filter.parentId);
    }
    if (filter?.query) {
      const pattern = `%${filter.query.replace(/[%_]/g, "\\$&")}%`;
      query = query.or(`title.ilike."${pattern}",body.ilike."${pattern}"`);
    }
    query = query.order("sort_order", { ascending: true }).order("title", { ascending: true });
    return (await rows<VaultPageRow>(query)).map(toDomain);
  }

  async listSummaries(): Promise<VaultPage[]> {
    let query = this.db.from(TABLE).select(VAULT_SUMMARY_COLUMNS);
    if (this.pid) query = query.eq("project_id", this.pid);
    query = query.order("sort_order", { ascending: true }).order("title", { ascending: true });
    const { data, error } = await query;
    if (error) {
      // Pre-migration fallback: derive preview from full body if body_preview is missing.
      if (isMissingBodyPreviewColumn(error)) {
        return this.listSummariesFromBody();
      }
      throw error;
    }
    return (data as VaultPageRow[]).map(toSummaryDomain);
  }

  /** Fallback when `body_preview` has not been migrated yet. */
  private async listSummariesFromBody(): Promise<VaultPage[]> {
    let query = this.db
      .from(TABLE)
      .select("id,title,parent_id,sort_order,created_at,updated_at,project_id,body");
    if (this.pid) query = query.eq("project_id", this.pid);
    query = query.order("sort_order", { ascending: true }).order("title", { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    return (data as VaultPageRow[]).map((row) => ({
      id: row.id,
      title: row.title,
      body: "",
      bodyPreview: vaultBodyPreview(row.body ?? ""),
      parentId: row.parent_id ?? undefined,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getTree(): Promise<VaultPageTreeNode[]> {
    let q = this.db.from(TABLE).select(VAULT_SUMMARY_COLUMNS);
    if (this.pid) q = q.eq("project_id", this.pid);
    const { data, error } = await q;
    if (error) {
      if (isMissingBodyPreviewColumn(error)) {
        return buildPageTree(await this.listSummariesFromBody());
      }
      throw error;
    }
    return buildPageTree((data as VaultPageRow[]).map(toSummaryDomain));
  }

  async save(entity: VaultPage): Promise<void> {
    const row = toRow(entity);
    if (this.pid) row.project_id = this.pid;
    await run(this.db.from(TABLE).upsert(row));
  }

  async delete(id: string): Promise<void> {
    await deleteRowById(this.db, TABLE, id);
  }
}

function isMissingBodyPreviewColumn(error: { message?: string; code?: string }): boolean {
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("body_preview") && (msg.includes("column") || error.code === "42703");
}

