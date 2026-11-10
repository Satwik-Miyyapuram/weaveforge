import { type IVaultPageRepository, type VaultPage, type VaultPageFilter, type VaultPageTreeNode } from "@weaveforge/core";
import type { EntityStamp } from "@weaveforge/core";
import type { VaultPageRow, VaultPageWriteRow } from "@weaveforge/wasm";
import { inChunks, one, rows, run, timestampsAsText } from "@/backend/providers/postgrest/row-access";
import { ProjectRepository } from "@/backend/providers/postgrest/project-scoped-repository";
import { typedCore } from "@/lib/rust-core";

// Row mapping runs in the Rust core (wf-core `vault::page_row`).
// Bindings type absent optional fields as `null`; the domain says `undefined`. The
// cast only retypes the Rust output, so runtime values (incl. `null`) are unchanged and
// `"bodyPreview" in page` still tells the projections apart.
const toDomain = (row: VaultPageRow): VaultPage => typedCore().vaultPageToDomain(timestampsAsText(row)) as unknown as VaultPage;
const toSummaryDomain = (row: VaultPageRow): VaultPage => typedCore().vaultPageToSummaryDomain(timestampsAsText(row)) as unknown as VaultPage;
const toRow = (page: VaultPage) => typedCore().vaultPageToRow(page);

/**
 * The columns a VaultPageRow is read as, named rather than starred.
 *
 * Derived from the row type: these are exactly the fields the mapper reads, and a
 * star would make them "whatever the table grows next".
 */
const VAULT_PAGE_COLUMNS = "id,title,body,body_preview,parent_id,pinned,folder,sort_order,created_at,updated_at";

const TABLE = "vault_pages";

/** Tree/card projection — preview only; full body via getById on open. */
const VAULT_SUMMARY_COLUMNS =
  "id,title,parent_id,pinned,folder,sort_order,created_at,updated_at,project_id,body_preview";

export class PostgrestVaultPageRepository extends ProjectRepository implements IVaultPageRepository {

  async getById(id: string): Promise<VaultPage | null> {
    const row = await one<VaultPageRow>(
      this.scoped(this.db.from(TABLE).select(VAULT_PAGE_COLUMNS)).eq("id", id).maybeSingle(),
    );
    return row ? toDomain(row) : null;
  }

  /** Ids and versions only — the cheap first half of a delta read. */
  async listStamps(): Promise<EntityStamp[]> {
    const query = this.scoped(this.db.from(TABLE).select("id,updated_at,created_at"))
      .order("sort_order", { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    return (data as { id: string; updated_at: string | null; created_at: string }[]).map((row) => ({
      id: row.id,
      updatedAt: row.updated_at ?? row.created_at,
    }));
  }

  async listByIds(ids: readonly string[]): Promise<VaultPage[]> {
    // Ordered by `id` so the result is deterministic.
    const found = await inChunks(ids, (chunk) =>
      rows<VaultPageRow>(
        this.scoped(this.db.from(TABLE).select(VAULT_PAGE_COLUMNS))
          .in("id", chunk)
          .order("id", { ascending: true }),
      ),
    );
    return found.map(toDomain);
  }

  async list(filter?: VaultPageFilter): Promise<VaultPage[]> {
    let query = this.scoped(this.db.from(TABLE).select(VAULT_PAGE_COLUMNS));
    if (filter?.parentId !== undefined) {
      query =
        filter.parentId === null
          ? query.is("parent_id", null)
          : query.eq("parent_id", filter.parentId);
    }
    // The Rust core escapes LIKE and PostgREST text and returns no filter for an empty query.
    const search = typedCore().vaultTitleOrBodyFilter(filter?.query ?? "");
    if (search) query = query.or(search);
    query = query.order("sort_order", { ascending: true }).order("title", { ascending: true });
    return (await rows<VaultPageRow>(query)).map(toDomain);
  }

  async listSummaries(): Promise<VaultPage[]> {
    const query = this.scoped(this.db.from(TABLE).select(VAULT_SUMMARY_COLUMNS))
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true });
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
    const query = this.scoped(
      this.db
        .from(TABLE)
        .select("id,title,parent_id,sort_order,created_at,updated_at,project_id,body"),
    )
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true });
    const { data, error } = await query;
    if (error) throw error;
    return (data as VaultPageRow[]).map((row) => ({
      ...toSummaryDomain(row),
      bodyPreview: typedCore().vaultBodyPreview(row.body ?? ""),
    }));
  }

  async getTree(): Promise<VaultPageTreeNode[]> {
    const q = this.scoped(this.db.from(TABLE).select(VAULT_SUMMARY_COLUMNS));
    const { data, error } = await q;
    if (error) {
      if (isMissingBodyPreviewColumn(error)) {
        return typedCore().buildPageTree(await this.listSummariesFromBody());
      }
      throw error;
    }
    return typedCore().buildPageTree((data as VaultPageRow[]).map(toSummaryDomain));
  }

  async titleTaken(title: string, exceptId?: string): Promise<boolean> {
    const key = typedCore().normalizeTitleKey(title);
    if (!key) return false;
    // ILIKE narrows to candidates (each whitespace run may differ, hence %);
    // the exact rule is applied here so both backends agree.
    const pattern = typedCore().vaultTitleLikePattern(key);
    const found = await rows<{ id: string; title: string }>(
      this.scoped(this.db.from(TABLE).select("id,title")).ilike("title", pattern),
    );
    return found.some((r) => r.id !== exceptId && typedCore().normalizeTitleKey(r.title) === key);
  }

  async save(entity: VaultPage): Promise<void> {
    const row = toRow(entity);
    // The write row has no project_id; it is added only for a project-scoped repository.
    const payload: VaultPageWriteRow & { project_id?: string } = this.pid ? { ...row, project_id: this.pid } : row;
    await run(this.db.from(TABLE).upsert(payload));
  }

  async delete(id: string): Promise<void> {
    await run(this.scoped(this.db.from(TABLE).delete()).eq("id", id));
  }
}

function isMissingBodyPreviewColumn(error: { message?: string; code?: string }): boolean {
  return typedCore().isMissingBodyPreviewColumn(error.message, error.code);
}

