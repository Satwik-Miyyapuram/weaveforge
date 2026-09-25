import type {
  Experiment,
  ExperimentFilter,
  ExperimentStatus,
  IExperimentRepository,
} from "@weaveforge/core";
import { experimentToDomain, experimentToRow, type ExperimentRow } from "./experiment-rows";
import { deleteRowById, rowById, rows, run } from "@/backend/providers/supabase/row-access";
import { ProjectRepository } from "@/backend/providers/supabase/project-scoped-repository";

/**
 * The columns a ExperimentRow is read as, named rather than starred.
 *
 * Derived from the row type: exactly the fields the mapper reads, where a star
 * would mean "whatever the table grows next".
 */
const EXPERIMENT_COLUMNS = "id,name,hypothesis,status,repo_url,commit_sha,branch,run_command,config,metrics,artifacts,result_note,started_at,finished_at,related_paper,created_at";

const TABLE = "experiments";

export class SupabaseExperimentRepository extends ProjectRepository implements IExperimentRepository {

  async getById(id: string): Promise<Experiment | null> {
    const row = await rowById<ExperimentRow>(this.db, TABLE, id);
    return row ? experimentToDomain(row) : null;
  }
  async list(filter?: ExperimentFilter): Promise<Experiment[]> {
    let q = this.db.from(TABLE).select(EXPERIMENT_COLUMNS);
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

