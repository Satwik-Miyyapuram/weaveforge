import type { ExperimentStatus } from "@weaveforge/core";

/**
 * How experiment rows are stored. The mapping to the domain type is in Rust (wf-core).
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
