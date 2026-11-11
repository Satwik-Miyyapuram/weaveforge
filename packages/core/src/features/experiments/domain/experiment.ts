/** Types for experiment. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { Identifiable } from "../../../shared/repository.js";
import { ValidationError } from "../../../shared/errors.js";

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
  /**
   * When the run reached a terminal status; absent while it has not.
   *
   * Invariant: `finishedAt` is present **iff** `status` is terminal. It is
   * enforced by {@link createExperiment} and by {@link statusPatchForExperiment}
   * rather than by the type. Making it unrepresentable would mean splitting
   * `Experiment` into a discriminated union of open and closed runs, which
   * touches every construction site, every repository row mapper, and every
   * consumer reading `experiment.finishedAt` — a refactor of its own rather than
   * a drive-by fix. What the type *can* do is refuse the transition that used to
   * leave a reopened run claiming an end time it no longer has.
   */
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

export class ExperimentValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentValidationError";
  }
}

/** The statuses that end a run. Kept here so `finishedAt` has one definition. */
export const TERMINAL_EXPERIMENT_STATUSES: readonly ExperimentStatus[] = [
  "done",
  "failed",
  "abandoned",
];

/** Running experiments with no finish and no activity this long are treated as dead. */
export const STALE_RUNNING_MS = 2 * 60 * 1000;

