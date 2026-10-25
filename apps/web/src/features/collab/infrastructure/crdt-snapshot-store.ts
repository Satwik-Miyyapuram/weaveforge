/**
 * Reads the `snapshot_upto` watermark on CRDT-backed entity tables (migration 0042).
 *
 * Read only: compaction moves the watermark inside `compact_crdt_log`, in the
 * same transaction that deletes the rows it covers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const TABLE_BY_TYPE: Record<string, string> = {
  vault_page: "vault_pages",
  report_section: "report_sections",
  log_entry: "log_entries",
};

export class CrdtSnapshotStore {
  constructor(private readonly db: SupabaseClient) {}

  async getSnapshotUpto(resourceType: string, resourceId: string): Promise<number> {
    const table = TABLE_BY_TYPE[resourceType];
    if (!table) return 0;
    const { data, error } = await this.db
      .from(table)
      .select("snapshot_upto")
      .eq("id", resourceId)
      .maybeSingle();
    if (error) throw error;
    return Number((data as { snapshot_upto: number | null } | null)?.snapshot_upto ?? 0);
  }
}
