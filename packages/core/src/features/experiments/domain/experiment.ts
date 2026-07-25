/**
 * Experiments domain model — pure, no I/O. An Experiment is one tracked run,
 * pinned to a code state (repo / branch / commit) like a git entry, with config
 * and metrics. One reason to change: the rules of what an experiment *is* (SRP).
 */

import type { Identifiable } from "../../../shared/repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";

export type ExperimentStatus =
  | "planned"
  | "running"
  | "done"
  | "failed"
  | "abandoned";

export const EXPERIMENT_STATUSES: readonly ExperimentStatus[] = [
  "planned",
  "running",
  "done",
  "failed",
  "abandoned",
];

export interface Experiment extends Identifiable {
  id: string;
  name: string;
  hypothesis?: string;
  status: ExperimentStatus;
  repoUrl?: string;
  commitSha?: string;
  branch?: string;
  runCommand?: string;
  /** Hyperparameters / dataset / seed. */
  config: Record<string, unknown>;
  /** {"val_loss": 0.118, "mig": 0.41, ...} */
  metrics: Record<string, unknown>;
  /** Links to checkpoints / plots (W&B, Storage, etc.). */
  artifacts: string[];
  resultNote?: string;
  startedAt?: string;
  finishedAt?: string;
  /** Paper this run tests/implements. */
  relatedPaper?: string;
  createdAt: string;
}

export interface NewExperimentInput {
  name: string;
  hypothesis?: string;
  status?: ExperimentStatus;
  repoUrl?: string;
  commitSha?: string;
  branch?: string;
  runCommand?: string;
  config?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  artifacts?: string[];
  resultNote?: string;
  relatedPaper?: string;
}

export interface ExperimentFilter {
  status?: ExperimentStatus;
  /** Case-insensitive substring match against name. */
  nameContains?: string;
  relatedPaper?: string;
}

export class ExperimentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentValidationError";
  }
}

export function createExperiment(
  input: NewExperimentInput,
  deps: { clock: Clock; ids: IdGenerator },
): Experiment {
  const name = input.name?.trim();
  if (!name) throw new ExperimentValidationError("Experiment name is required.");
  const now = deps.clock.nowIso();
  const status = input.status ?? "planned";
  return {
    id: deps.ids.newId(),
    name,
    hypothesis: input.hypothesis,
    status,
    repoUrl: input.repoUrl,
    commitSha: input.commitSha?.trim(),
    branch: input.branch?.trim(),
    runCommand: input.runCommand,
    config: input.config ?? {},
    metrics: input.metrics ?? {},
    artifacts: input.artifacts ?? [],
    resultNote: input.resultNote,
    startedAt: status === "running" ? now : undefined,
    relatedPaper: input.relatedPaper,
    createdAt: now,
  };
}

/** Short display form of a commit SHA. */
export function shortSha(sha?: string): string | undefined {
  return sha ? sha.trim().slice(0, 7) : undefined;
}

/** Running experiments with no finish and no activity this long are treated as dead. */
export const STALE_RUNNING_MS = 2 * 60 * 1000;

export function experimentActivityAt(exp: Experiment): number {
  const raw = exp.startedAt ?? exp.createdAt;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

/** SDK / process died without updating status — still marked running in the DB. */
export function isStaleRunningExperiment(
  exp: Experiment,
  nowMs: number = Date.now(),
  staleMs: number = STALE_RUNNING_MS,
  lastMetricAtMs?: number,
): boolean {
  if (exp.status !== "running") return false;
  const activity = Math.max(experimentActivityAt(exp), lastMetricAtMs ?? 0);
  if (!activity) return false;
  return nowMs - activity >= staleMs;
}

/** Format a numeric metric value for tables and chart axes (name-agnostic). */
export function formatMetricValue(_metric: string, value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e6 || (abs > 0 && abs < 1e-4)) return value.toExponential(2);
  if (abs >= 100) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(3);
  if (abs >= 0.01) return value.toFixed(4);
  return value.toExponential(2);
}
