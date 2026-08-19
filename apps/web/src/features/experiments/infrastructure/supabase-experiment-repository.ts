import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Experiment,
  ExperimentFilter,
  ExperimentStatus,
  IExperimentRepository,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import {
  attachEncryptedRow,
  encryptedRowFields,
} from "@/lib/encrypted-row";
import { experimentToDomain, experimentToRow, type ExperimentRow as StoredExperimentRow } from "./experiment-rows";

/** The stored row plus the columns only this provider carries. */
interface ExperimentRow extends StoredExperimentRow {
  content_enc: string | null;
  enc_epoch: number | null;
}
const TABLE = "experiments";

export class SupabaseExperimentRepository implements IExperimentRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
  ) {}
  private get pid() { return this.ctx.projectId; }

  async getById(id: string): Promise<Experiment | null> {
    const { data, error } = await this.db.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toDomain(data as ExperimentRow) : null;
  }
  async list(filter?: ExperimentFilter): Promise<Experiment[]> {
    let q = this.db.from(TABLE).select("*");
    if (this.pid) q = q.or(`project_id.eq.${this.pid},project_id.is.null`);
    if (filter?.status) q = q.eq("status", filter.status);
    if (filter?.relatedPaper) q = q.eq("related_paper", filter.relatedPaper);
    if (filter?.nameContains) {
      // Server ilike removed under E2EE — encryptRepo filters client-side post-decrypt.
    }
    q = q.order("created_at", { ascending: false });
    const { data, error } = await q;
    if (error) throw error;
    return (data as ExperimentRow[]).map(toDomain);
  }
  async save(entity: Experiment): Promise<void> {
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

function toDomain(r: ExperimentRow): Experiment {
  return attachEncryptedRow(experimentToDomain(r), r);
}
function toRow(e: Experiment): Record<string, unknown> {
  return { ...experimentToRow(e), ...encryptedRowFields(e) };
}
