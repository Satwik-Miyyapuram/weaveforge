import type { SupabaseClient } from "@supabase/supabase-js";
import type { IMilestoneRepository, Milestone, MilestoneFilter } from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import { milestoneToDomain, milestoneToRow, type MilestoneRow } from "./milestone-rows";
import { deleteRowById, rowById } from "@/backend/providers/supabase/row-access";

const TABLE = "milestones";

export class SupabaseMilestoneRepository implements IMilestoneRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
  ) {}
  private get pid() { return this.ctx.projectId; }

  async getById(id: string): Promise<Milestone | null> {
    const row = await rowById<MilestoneRow>(this.db, TABLE, id);
    return row ? milestoneToDomain(row) : null;
  }
  async list(filter?: MilestoneFilter): Promise<Milestone[]> {
    if (!this.pid) return [];
    let q = this.db.from(TABLE).select("*");
    q = q.eq("project_id", this.pid);
    if (filter?.status) q = q.eq("status", filter.status);
    if (filter?.titleContains) {
      // Server ilike removed under E2EE — encryptRepo filters client-side post-decrypt.
    }
    // Soonest target first; undated milestones sink to the end.
    q = q.order("target_date", { ascending: true, nullsFirst: false });
    const { data, error } = await q;
    if (error) throw error;
    return (data as MilestoneRow[]).map(milestoneToDomain);
  }
  async save(entity: Milestone): Promise<void> {
    const row = milestoneToRow(entity);
    if (this.pid) row.project_id = this.pid;
    const { error } = await this.db.from(TABLE).upsert(row);
    if (error) throw error;
  }
  async delete(id: string): Promise<void> {
    await deleteRowById(this.db, TABLE, id);
  }
}

