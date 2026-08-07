import type { ShareableType } from "@weaveforge/core";
import type { SharedItem, ISharedReader } from "@/features/sharing/domain/shared-reader";
import type { PgRunner } from "../pg-runner";

const SOURCES: Record<ShareableType, { table: string; title: string; status: string | null }> = {
  milestone: { table: "milestones", title: "title", status: "status" },
  experiment: { table: "experiments", title: "name", status: "status" },
  report_section: { table: "report_sections", title: "title", status: "status" },
  reading_list: { table: "reading_lists", title: "name", status: null },
  paper: { table: "papers", title: "title", status: "status" },
  vault_page: { table: "vault_pages", title: "title", status: null },
};

export class PostgresSharedReader implements ISharedReader {
  constructor(private readonly pg: PgRunner) {}

  async read(kind: ShareableType, ids: string[], owners: string[]): Promise<SharedItem[]> {
    if (ids.length === 0 && owners.length === 0) return [];

    const cfg = SOURCES[kind];
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (ids.length) {
      params.push(ids);
      clauses.push(`id = any($${params.length}::uuid[])`);
    }
    if (owners.length) {
      params.push(owners);
      clauses.push(`user_id = any($${params.length}::uuid[])`);
    }

    const statusCol = cfg.status ? `, ${cfg.status}` : "";
    const extra = kind === "paper" ? ", metadata" : "";
    const rows = await this.pg.query<Record<string, unknown>>(
      `select id, ${cfg.title}, user_id${statusCol}${extra}
       from ${cfg.table}
       where ${clauses.join(" or ")}`,
      params,
    );

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
