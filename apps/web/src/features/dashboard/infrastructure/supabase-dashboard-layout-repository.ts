import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardLayout, IDashboardLayoutRepository } from "@weaveforge/core";
import { parseDashboardLayout } from "@weaveforge/core";

const TABLE = "projects";

export class SupabaseDashboardLayoutRepository implements IDashboardLayoutRepository {
  constructor(private readonly db: SupabaseClient) {}

  async get(projectId: string): Promise<DashboardLayout | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select("dashboard_layout")
      .eq("id", projectId)
      .maybeSingle();
    if (error) throw error;
    if (!data?.dashboard_layout) return null;
    return parseDashboardLayout(data.dashboard_layout);
  }

  async save(projectId: string, layout: DashboardLayout): Promise<void> {
    const { error } = await this.db
      .from(TABLE)
      .update({ dashboard_layout: layout })
      .eq("id", projectId);
    if (error) throw error;
  }
}
