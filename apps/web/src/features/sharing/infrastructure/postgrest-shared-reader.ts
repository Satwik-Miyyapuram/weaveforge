import type { ShareableType } from "@weaveforge/core";
import type { SharedItem, ISharedReader } from "../domain/shared-reader";

import { readyCore } from "@/lib/rust-core";
import { toSharedItem } from "./shared-reader-sources";

export type { SharedItem } from "../domain/shared-reader";

/**
 * Fetches the actual rows behind a set of shares — by id (per-item grants) or by
 * owner (blanket "share everything" grants). Reads whatever the widened SELECT
 * policies (0018) permit, independent of the project-scoped feature repos.
 */
export class PostgrestSharedReader implements ISharedReader {
  constructor(private readonly db: import("@supabase/supabase-js").SupabaseClient) {}

  async read(kind: ShareableType, ids: string[], owners: string[]): Promise<SharedItem[]> {
    // Table, columns and filter come from Rust (`shared_read_plan`); no plan, no request.
    const plan = readyCore().sharedReadPlan(kind, ids, owners);
    if (!plan) return [];

    const { data, error } = await this.db.from(plan.table).select(plan.columns).or(plan.filter);
    if (error) throw error;
    // The dynamic column list makes PostgREST infer an error type; the rows are
    // plain records, so cast through unknown.
    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => toSharedItem(kind, r));
  }
}
