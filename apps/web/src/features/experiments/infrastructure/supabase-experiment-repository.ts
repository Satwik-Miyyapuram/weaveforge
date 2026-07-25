import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Experiment,
  ExperimentFilter,
  ExperimentStatus,
  IExperimentRepository,
} from "@thesis/core";
import type { ProjectContext } from "@/lib/project-context";
import {
  attachEncryptedRow,
  encryptedRowFields,
} from "@/lib/encrypted-row";

interface ExperimentRow {
  id: string;
  name: string;
  hypothesis: string | null;
  status: ExperimentStatus;
  repo_url: string | null;
  commit_sha: string | null;
  branch: string | null;
  run_command: string | null;
  config: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  artifacts: string[] | null;
  result_note: string | null;
  started_at: string | null;
  finished_at: string | null;
  related_paper: string | null;
  created_at: string;
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
  return attachEncryptedRow(
    {
      id: r.id,
      name: r.name,
      hypothesis: r.hypothesis ?? undefined,
      status: r.status,
      repoUrl: r.repo_url ?? undefined,
      commitSha: r.commit_sha ?? undefined,
      branch: r.branch ?? undefined,
      runCommand: r.run_command ?? undefined,
      config: r.config ?? {},
      metrics: r.metrics ?? {},
      artifacts: r.artifacts ?? [],
      resultNote: r.result_note ?? undefined,
      startedAt: r.started_at ?? undefined,
      finishedAt: r.finished_at ?? undefined,
      relatedPaper: r.related_paper ?? undefined,
      createdAt: r.created_at,
    },
    r,
  );
}
function toRow(e: Experiment): Record<string, unknown> {
  return {
    id: e.id,
    name: e.name ?? "",
    hypothesis: e.hypothesis ?? null,
    status: e.status,
    repo_url: e.repoUrl ?? null,
    commit_sha: e.commitSha ?? null,
    branch: e.branch ?? null,
    run_command: e.runCommand ?? null,
    config: e.config ?? {},
    metrics: e.metrics ?? {},
    artifacts: e.artifacts ?? [],
    result_note: e.resultNote ?? null,
    started_at: e.startedAt ?? null,
    finished_at: e.finishedAt ?? null,
    related_paper: e.relatedPaper ?? null,
    created_at: e.createdAt,
    ...encryptedRowFields(e),
  };
}
