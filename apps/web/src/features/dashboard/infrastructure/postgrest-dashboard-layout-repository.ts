import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardLayout, IDashboardLayoutRepository } from "@weaveforge/core";
import { run } from "@/backend/providers/postgrest/row-access";
import { readyCore } from "@/lib/rust-core";

const TABLE = "projects";

export class PostgrestDashboardLayoutRepository implements IDashboardLayoutRepository {
  constructor(private readonly db: SupabaseClient) {}

  async get(projectId: string): Promise<DashboardLayout | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("dashboard_layout")
      .eq("id", projectId)
      .maybeSingle();
    if (error) throw error;
    if (!data?.dashboard_layout) return null;
    // Rust keeps only cards with a known card type.
    return readyCore().parseDashboardLayout(data.dashboard_layout) as DashboardLayout | null;
  }

  async save(projectId: string, layout: DashboardLayout): Promise<void> {
    await run(this.db
      .from(TABLE)
      .update({ dashboard_layout: layout })
      .eq("id", projectId));
  }
}
