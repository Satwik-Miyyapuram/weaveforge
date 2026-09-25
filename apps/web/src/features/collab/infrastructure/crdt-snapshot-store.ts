/**
 * Read/write `snapshot_upto` watermark on CRDT-backed entity tables (migration 0042).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { run } from "@/backend/providers/supabase/row-access";

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

  async setSnapshotUpto(
    resourceType: string,
    resourceId: string,
    uptoId: number,
  ): Promise<void> {
    const table = TABLE_BY_TYPE[resourceType];
    if (!table) return;
    // Monotonic by construction. Co-editing means two clients can compact, and
    // the loader replays updates by `id > watermark` — so a client that read the
    // watermark before a newer compaction ran would otherwise rewind it and ask
    // every reader to replay a range whose rows no longer exist. A read-compare-
    // write in the application is racy; the condition belongs in the statement.
    //
    // `snapshot_upto` starts null (migration 0042), so "not set yet" has to be
    // spelled out as well: `lt` alone would never match a null row and
    // compaction would never start.
    await run(this.db
      .from(table)
      .update({ snapshot_upto: uptoId })
      .eq("id", resourceId)
      .or(`snapshot_upto.is.null,snapshot_upto.lt.${uptoId}`));
  }
}
