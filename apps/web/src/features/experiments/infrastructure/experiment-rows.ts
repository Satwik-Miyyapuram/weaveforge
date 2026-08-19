import type {
  Experiment,
  ExperimentStatus,
} from "@weaveforge/core";

/**
 * How experiment rows are stored, and how they map to the domain type.
 *
 * Shared by both backend providers, which talk to the same table through
 * different clients.
 */

export interface ExperimentRow {
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
}

export function experimentToDomain(r: ExperimentRow): Experiment {
  return {
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
  };
}

export function experimentToRow(e: Experiment): Record<string, unknown> {
  return {
    id: e.id,
    name: e.name,
    hypothesis: e.hypothesis ?? null,
    status: e.status,
    repo_url: e.repoUrl ?? null,
    commit_sha: e.commitSha ?? null,
    branch: e.branch ?? null,
    run_command: e.runCommand ?? null,
    config: e.config,
    metrics: e.metrics,
    artifacts: e.artifacts,
    result_note: e.resultNote ?? null,
    started_at: e.startedAt ?? null,
    finished_at: e.finishedAt ?? null,
    related_paper: e.relatedPaper ?? null,
    created_at: e.createdAt,
  };
}
