import type { ShareableType } from "@thesis/core";
import type { SharedItem, ISharedReader } from "../domain/shared-reader";

export type { SharedItem } from "../domain/shared-reader";

/** Per-type row mapping: which table, and which columns hold the title/status. */
const SOURCES: Record<ShareableType, { table: string; title: string; status: string | null }> = {
  milestone: { table: "milestones", title: "title", status: "status" },
  experiment: { table: "experiments", title: "name", status: "status" },
  report_section: { table: "report_sections", title: "title", status: "status" },
  reading_list: { table: "reading_lists", title: "name", status: null },
  paper: { table: "papers", title: "title", status: "status" },
  vault_page: { table: "vault_pages", title: "title", status: null },
};

/**
 * Fetches the actual rows behind a set of shares — by id (per-item grants) or by
 * owner (blanket "share everything" grants). Reads whatever the widened SELECT
 * policies (0018) permit, independent of the project-scoped feature repos.
 */
export class SupabaseSharedReader implements ISharedReader {
  constructor(private readonly db: import("@supabase/supabase-js").SupabaseClient) {}

  async read(kind: ShareableType, ids: string[], owners: string[]): Promise<SharedItem[]> {
    const parts: string[] = [];
    if (ids.length) parts.push(`id.in.(${ids.join(",")})`);
    if (owners.length) parts.push(`user_id.in.(${owners.join(",")})`);
    if (parts.length === 0) return [];

    const cfg = SOURCES[kind];
    const extra = kind === "paper" ? ", metadata" : "";
    const cols = ["id", cfg.title, cfg.status, "user_id"].filter(Boolean).join(", ") + extra;
    const { data, error } = await this.db.from(cfg.table).select(cols).or(parts.join(","));
    if (error) throw error;
    // The dynamic column list makes PostgREST infer an error type; the rows are
    // plain records, so cast through unknown.
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id ?? ""),
      kind,
      title: String(r[cfg.title] ?? "(untitled)"),
      status: cfg.status ? String(r[cfg.status] ?? "") : "",
      ownerId: String(r.user_id ?? ""),
      metadata:
        kind === "paper" && r.metadata && typeof r.metadata === "object"
          ? (r.metadata as Record<string, unknown>)
          : undefined,
    }));
  }
}
