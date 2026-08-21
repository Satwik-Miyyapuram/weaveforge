import type { ShareableType } from "@weaveforge/core";
import type { SharedItem, ISharedReader } from "@/features/sharing/domain/shared-reader";
import type { PgRunner } from "../pg-runner";
import { SHARED_SOURCES, toSharedItem } from "@/features/sharing/infrastructure/shared-reader-sources";

export class PostgresSharedReader implements ISharedReader {
  constructor(private readonly pg: PgRunner) {}

  async read(kind: ShareableType, ids: string[], owners: string[]): Promise<SharedItem[]> {
    if (ids.length === 0 && owners.length === 0) return [];

    const cfg = SHARED_SOURCES[kind];
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

    return rows.map((r) => toSharedItem(kind, r));
  }
}
