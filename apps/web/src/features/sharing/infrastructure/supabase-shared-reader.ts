import type { ShareableType } from "@weaveforge/core";
import type { SharedItem, ISharedReader } from "../domain/shared-reader";

import { SHARED_SOURCES, toSharedItem } from "./shared-reader-sources";

export type { SharedItem } from "../domain/shared-reader";

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

    const cfg = SHARED_SOURCES[kind];
    const extra = kind === "paper" ? ", metadata" : "";
    const cols = ["id", cfg.title, cfg.status, "user_id"].filter(Boolean).join(", ") + extra;
    const { data, error } = await this.db.from(cfg.table).select(cols).or(parts.join(","));
    if (error) throw error;
    // The dynamic column list makes PostgREST infer an error type; the rows are
    // plain records, so cast through unknown.
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => toSharedItem(kind, r));
  }
}
