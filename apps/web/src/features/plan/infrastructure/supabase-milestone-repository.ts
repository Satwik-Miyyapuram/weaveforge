import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ComputeNeed,
  IMilestoneRepository,
  Milestone,
  MilestoneDependency,
  MilestoneFilter,
  MilestoneStatus,
} from "@thesis/core";
import type { ProjectContext } from "@/lib/project-context";
import {
  attachEncryptedRow,
  encryptedRowFields,
} from "@/lib/encrypted-row";

interface MilestoneRow {
  id: string;
  title: string;
  description: string | null;
  status: MilestoneStatus;
  target_date: string | null;
  dependencies: MilestoneDependency[] | null;
  compute: ComputeNeed[] | null;
  created_at: string;
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
  return attachEncryptedRow(
    {
      id: r.id,
      title: r.title,
      description: r.description ?? undefined,
      status: r.status,
      targetDate: r.target_date ?? undefined,
      dependencies: r.dependencies ?? [],
      compute: r.compute ?? [],
      createdAt: r.created_at,
    },
    r,
  );
}
function toRow(m: Milestone): Record<string, unknown> {
  return {
    id: m.id,
    title: m.title ?? "",
    description: m.description ?? null,
    status: m.status,
    target_date: m.targetDate ?? null,
    dependencies: m.dependencies ?? [],
    compute: m.compute ?? [],
    created_at: m.createdAt,
    ...encryptedRowFields(m),
  };
}
