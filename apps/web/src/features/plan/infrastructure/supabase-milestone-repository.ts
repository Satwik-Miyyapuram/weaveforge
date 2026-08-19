import type { SupabaseClient } from "@supabase/supabase-js";
import type { IMilestoneRepository, Milestone, MilestoneFilter } from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import {
  attachEncryptedRow,
  encryptedRowFields,
} from "@/lib/encrypted-row";
import { milestoneToDomain, milestoneToRow, type MilestoneRow as StoredMilestone } from "./milestone-rows";

/** The stored row plus the columns only this provider carries. */
interface MilestoneRow extends StoredMilestone {
  content_enc: string | null;
  enc_epoch: number | null;
}
const TABLE = "milestones";

export class SupabaseMilestoneRepository implements IMilestoneRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
  ) {}
  private get pid() { return this.ctx.projectId; }

  async getById(id: string): Promise<Milestone | null> {
    const { data, error } = await this.db.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as MilestoneRow) : null;
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
    return (data as MilestoneRow[]).map(toDomain);
  }
  async save(entity: Milestone): Promise<void> {
    const row = toRow(entity);
    if (this.pid) row.project_id = this.pid;
    const { error } = await this.db.from(TABLE).upsert(row);
    if (error) throw error;
  }
  async delete(id: string): Promise<void> {
    const { error } = await this.db.from(TABLE).delete().eq("id", id);
    if (error) throw error;
  }
}

function toDomain(r: MilestoneRow): Milestone {
  return attachEncryptedRow(milestoneToDomain(r), r);
}
function toRow(m: Milestone): Record<string, unknown> {
  return { ...milestoneToRow(m), ...encryptedRowFields(m) };
}
