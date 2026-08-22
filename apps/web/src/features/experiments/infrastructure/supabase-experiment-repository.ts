import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Experiment,
  ExperimentFilter,
  ExperimentStatus,
  IExperimentRepository,
} from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";
import { experimentToDomain, experimentToRow, type ExperimentRow } from "./experiment-rows";
import { deleteRowById, rowById, rows, run } from "@/backend/providers/supabase/row-access";

const TABLE = "experiments";

export class SupabaseExperimentRepository implements IExperimentRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
  ) {}
  private get pid() { return this.ctx.projectId; }

  async getById(id: string): Promise<Experiment | null> {
    const row = await rowById<ExperimentRow>(this.db, TABLE, id);
    return row ? experimentToDomain(row) : null;
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
    return (await rows<ExperimentRow>(q)).map(experimentToDomain);
  }
  async save(entity: Experiment): Promise<void> {
    const row = experimentToRow(entity);
    if (this.pid) row.project_id = this.pid;
    await run(this.db.from(TABLE).upsert(row));
  }
  async delete(id: string): Promise<void> {
    await deleteRowById(this.db, TABLE, id);
  }
}

